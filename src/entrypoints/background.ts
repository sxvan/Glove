import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createScheduler } from '@/lib/scheduler';
import { analyzeDocumentFp } from '@/lib/fp-analysis';
import { dnsLookup } from '@/lib/dns-lookup';
import { extractSubdomain, getHostname, scoreSubdomainEntropy } from '@/lib/http-utils';
import { createSession, ensureDocument, updateDocumentRoute, updateCurrentDocument, storeHttpEvent, storeFpEvent, documentExists } from '@/lib/session-manager';
import type { FpMetrics, FpSpike, HttpRequest } from '@/types/analysis';
import type { AnalysisUpdatedMessage, GetTabSnapshotMessage, RecorderMessage } from '@/types/messages';
import type { DocumentState, FrameState, ScriptState, Session } from '@/types/session';
import type { DocumentSnapshot, FrameSnapshot, MetricsSnapshot, ScriptSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';

const DEBOUNCE_MS = 500;
const MAX_INTERVAL_MS = 5000;

export default defineBackground(() => {
    const session = createSession();
    const fpScheduler = createScheduler({ debounceMs: DEBOUNCE_MS, maxIntervalMs: MAX_INTERVAL_MS });

    function storeHttpRequest(tabId: number, frameId: number, documentId: string, details: Browser.webRequest.OnBeforeRequestDetails) {
        if (details.url.startsWith('chrome-extension://')) {
            return;
        }

        if (!documentExists(session, tabId, frameId, documentId)) {
            return;
        }

        const { document } = ensureDocument(session, tabId, frameId, documentId, null);
        if (!document) {
            // console.warn('No document found for HTTP event', { tabId, frameId, documentId, httpEvent });
            return;
        }

        const hostname = getHostname(details.url);
        if (!session.dnsResults.has(hostname!)) {
            dnsLookup(hostname).then((dnsResponse) => {
                session.dnsResults.set(hostname!, dnsResponse);
            });
        }

        const httpEvent: HttpRequest = { ...details, documentUrl: document.currentUrl, hostname };
        document.httpRequests.push(httpEvent);

        fpScheduler.notify(document.documentId, () => {
            analyzeDocumentFp(document, session.dnsResults);
            broadcastTabSnapshot(session, tabId);
        });
    }

    browser.runtime.onMessage.addListener((msg: RecorderMessage, sender) => {
        if (!sender.tab || sender.tab.id === -1 || sender.frameId === -1 || !sender.documentId) {
            return;
        }

        if (!msg || !msg.type || !msg.payload) {
            return;
        }

        const tabId = sender.tab.id!;
        const frameId = sender.frameId!;
        const { document } = ensureDocument(session, tabId, frameId, sender.documentId, sender.url);

        if (msg.type === 'fp') {
            storeFpEvent(session, tabId, frameId, sender.documentId, sender.url, msg.payload);

            fpScheduler.notify(document.documentId, () => {
                analyzeDocumentFp(document, session.dnsResults);
                broadcastTabSnapshot(session, tabId);
            });
            return;
        }

        if (msg.type === 'http') {
            storeHttpEvent(session, tabId, frameId, sender.documentId, sender.url, msg.payload);

            fpScheduler.notify(document.documentId, () => {
                analyzeDocumentFp(document, session.dnsResults);
                broadcastTabSnapshot(session, tabId);
            });
            return;
        }
    });

    browser.runtime.onMessage.addListener((msg: GetTabSnapshotMessage, sender, sendResponse) => {
        if (msg.type === 'GET_TAB_SNAPSHOT') {
            const tabId = Number(msg.tabId);
            const snapshot = buildTabSnapshot(session, tabId);
            sendResponse(snapshot);
            return;
        }
    });

    browser.webRequest.onBeforeRequest.addListener(
        (details) => {
            const { tabId, frameId, documentId } = details;

            if (tabId === -1 || frameId === -1 || !documentId) {
                return;
            }

            storeHttpRequest(tabId, frameId, documentId, details);

            return {};
        },
        { urls: ['<all_urls>'] },
        ['requestBody']
    );

    browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
        const { tabId, frameId, url, documentId } = details;

        if (tabId === -1 || frameId === -1 || !documentId) {
            return;
        }

        updateDocumentRoute(session, tabId, frameId, documentId, url);
    });

    browser.webNavigation.onCommitted.addListener((details) => {
        const { tabId, frameId, url, documentId } = details;

        if (tabId === -1 || frameId === -1 || !documentId) {
            return;
        }

        updateCurrentDocument(session, tabId, frameId, documentId, url);
    });
});

function broadcastTabSnapshot(session: Session, tabId: number) {
    const snapshot = buildTabSnapshot(session, tabId);
    console.log('Broadcasting snapshot for tab', tabId, snapshot);
    const message: AnalysisUpdatedMessage = { type: 'ANALYSIS_UPDATED', tabId, data: snapshot };
    browser.runtime.sendMessage(message);
}

function buildTabSnapshot(session: Session, tabId: number): TabSnapshot {
    const tabState = session.tabs[tabId];

    const tabSnapshot: TabSnapshot = {
        cNameRequests: collectCnameCloakedRequestsForTab(session, tabId),
        dnsTrackingRequests: collectDnsTrackingRequestsForTab(session, tabId),
        // TODO(bug): tabState is undefined for tabs without recorded data, which throws here.
        frames: Object.entries(tabState!.frames).map(([frameId, frameState]) => frameSnapshotFromFrame(frameState, frameId)),
    };

    return tabSnapshot;
}

function frameSnapshotFromFrame(frame: FrameState, frameId: string): FrameSnapshot | null {
    const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;

    if (!document) {
        console.warn('No current document for frame', frameId);
        return null;
    }

    return {
        frameId: frameId,
        document: documentSnapshotFromDocument(document),
    };
}

function documentSnapshotFromDocument(document: DocumentState): DocumentSnapshot {
    return {
        documentId: document.documentId,
        url: document.currentUrl,
        fpMetrics: convertToMetricsSnapshot(document.fpMetrics),
        scripts: Object.entries(document.scripts).map(([scriptName, script]) => scriptSnapshotFromScript(script, scriptName)),
    };
}

function scriptSnapshotFromScript(script: ScriptState, scriptName: string): ScriptSnapshot {
    return {
        name: scriptName,
        fpMetrics: convertToMetricsSnapshot(script.fpMetrics),
        fpSpikes: script.fpSpikes.map(convertToSpikeSnapshot),
    };
}

function collectCnameCloakedRequestsForTab(session: Session, tabId: number): HttpRequest[] {
    const tab = session.tabs[tabId];
    if (!tab) return [];

    const results: HttpRequest[] = [];

    for (const [frameId, frame] of Object.entries(tab.frames)) {
        const docId = frame.currentDocumentId;
        if (!docId) continue;

        const doc = frame.documents[docId];
        if (!doc || !doc.httpRequests) continue;

        for (const req of doc.httpRequests) {
            if (req && req.isCnameCloaked) {
                results.push(req);
            }
        }
    }

    return results;
}

function collectDnsTrackingRequestsForTab(session: Session, tabId: number): HttpRequest[] {
    const tab = session.tabs[tabId];
    if (!tab) return [];

    const results: HttpRequest[] = [];

    for (const [frameId, frame] of Object.entries(tab.frames)) {
        const docId = frame.currentDocumentId;
        if (!docId) continue;

        const doc = frame.documents[docId];
        if (!doc || !doc.httpRequests) continue;

        for (const req of doc.httpRequests) {
            const subdomainScore = scoreSubdomainEntropy(extractSubdomain(req.hostname));
            req.subdomainScore = subdomainScore;
            if (req.subdomainScore >= 0.2) {
                results.push(req);
            }
        }
    }

    results.sort((a, b) => (b.subdomainScore || 0) - (a.subdomainScore || 0));

    console.log(results);

    return results;
}

function convertToMetricsSnapshot(fpMetrics: FpMetrics | null | undefined): MetricsSnapshot | null {
    if (!fpMetrics) {
        return null;
    }

    return {
        distinctFpApis: Array.from(fpMetrics.distinctFpApis),
        distinctFpCategories: Array.from(fpMetrics.distinctFpCategories),
        intensity: fpMetrics.intensity,
        durationMs: fpMetrics.durationMs,
        density: fpMetrics.density,
        startTime: fpMetrics.startTime,
        endTime: fpMetrics.endTime,
        score: fpMetrics.score,
    };
}

function convertToSpikeSnapshot(fpSpike: FpSpike): SpikeSnapshot | null {
    if (!fpSpike) {
        return null;
    }
    return {
        events: fpSpike.events,
        fpMetrics: convertToMetricsSnapshot(fpSpike.fpMetrics),
        httpCorrelations: fpSpike.httpCorrelations,
    };
}
