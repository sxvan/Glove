import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createScheduler } from '@/lib/scheduler';
import { analyzeDocumentFp } from '@/lib/fp-analysis';
import { dnsLookup } from '@/lib/dns-lookup';
import { extractSubdomain, getHostname, scoreSubdomainEntropy } from '@/lib/http-utils';
import { DEFAULT_SETTINGS, loadScoringSettings, watchScoringSettings, type ScoringSettings } from '@/lib/scoring';
import { createSession, dropPreviousPageFrames, ensureDocument, updateDocumentRoute, updateCurrentDocument, storeHttpEvent, storeFpEvent, documentExists } from '@/lib/session-manager';
import type { FpMetrics, FpSpike, HttpRequest } from '@/types/analysis';
import type { AnalysisUpdatedMessage, GetTabSnapshotMessage, RecorderMessage } from '@/types/messages';
import type { DocumentState, FrameState, ScriptState, Session } from '@/types/session';
import type { CallLocation, DocumentSnapshot, FrameSnapshot, MetricsSnapshot, ScriptSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';

const DEBOUNCE_MS = 500;
const MAX_INTERVAL_MS = 5000;

// The user's scoring settings (see lib/scoring); the defaults until they are loaded.
let settings: ScoringSettings = DEFAULT_SETTINGS;

export default defineBackground(() => {
    const session = createSession();
    const fpScheduler = createScheduler({ debounceMs: DEBOUNCE_MS, maxIntervalMs: MAX_INTERVAL_MS });

    // In-flight DNS lookups by hostname, shared by all requests to that host.
    const pendingLookups = new Map<string, Promise<void>>();

    function scheduleAnalysis(document: DocumentState, tabId: number) {
        fpScheduler.notify(document.documentId, () => {
            analyzeDocumentFp(document, session.dnsResults, settings);
            broadcastTabSnapshot(session, tabId);
        });
    }

    /** Scores every open page again, e.g. after the user changed the scoring settings. */
    function reanalyzeAll() {
        for (const [tabId, tab] of Object.entries(session.tabs)) {
            for (const frame of Object.values(tab.frames)) {
                const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
                if (document) analyzeDocumentFp(document, session.dnsResults, settings);
            }
            broadcastTabSnapshot(session, Number(tabId));
        }
    }

    loadScoringSettings().then(
        (loaded) => {
            settings = loaded;
            reanalyzeAll();
        },
        (error) => console.warn('Could not load the scoring settings; using the defaults', error)
    );
    watchScoringSettings((changed) => {
        settings = changed;
        reanalyzeAll();
    });

    /** Resolves once a DNS result for the host is cached; rejects if the lookup failed (it is retried later). */
    function lookUpHost(hostname: string): Promise<void> {
        if (session.dnsResults.has(hostname)) {
            return Promise.resolve();
        }

        let lookup = pendingLookups.get(hostname);
        if (!lookup) {
            lookup = dnsLookup(hostname)
                .then((dnsResult) => {
                    session.dnsResults.set(hostname, dnsResult);
                })
                .finally(() => pendingLookups.delete(hostname));
            pendingLookups.set(hostname, lookup);
        }
        return lookup;
    }

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
        const httpEvent: HttpRequest = { ...details, documentUrl: document.currentUrl, hostname, bodyBytes: bodySize(details.requestBody) };
        document.httpRequests.push(httpEvent);

        scheduleAnalysis(document, tabId);

        // Analyze again once the host's DNS result arrives, so the request gets its CNAME details.
        if (hostname && !session.dnsResults.has(hostname)) {
            lookUpHost(hostname).then(
                () => scheduleAnalysis(document, tabId),
                (error) => console.warn('DNS lookup failed', hostname, error)
            );
        }
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

        if (msg.type === 'fp-batch') {
            for (const fpEvent of msg.payload) {
                storeFpEvent(session, tabId, frameId, sender.documentId, sender.url, fpEvent);
            }

            scheduleAnalysis(document, tabId);
            return;
        }

        if (msg.type === 'http') {
            storeHttpEvent(session, tabId, frameId, sender.documentId, sender.url, msg.payload);

            scheduleAnalysis(document, tabId);
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
        if (frameId === 0) dropPreviousPageFrames(session, tabId, details.timeStamp);
    });
});

/** The size of a request's body in bytes: raw data, or form fields as sent. */
function bodySize(body: Browser.webRequest.OnBeforeRequestDetails['requestBody']): number {
    if (!body) return 0;
    let bytes = 0;
    for (const part of body.raw ?? []) bytes += part.bytes?.byteLength ?? 0;
    for (const [name, values] of Object.entries(body.formData ?? {})) {
        for (const value of values) bytes += name.length + String(value).length + 2; // name=value&
    }
    return bytes;
}

function broadcastTabSnapshot(session: Session, tabId: number) {
    const snapshot = buildTabSnapshot(session, tabId);
    console.log('Broadcasting snapshot for tab', tabId, snapshot);
    const message: AnalysisUpdatedMessage = { type: 'ANALYSIS_UPDATED', tabId, data: snapshot };
    // Rejects when no popup is open to receive it, which is the usual case.
    browser.runtime.sendMessage(message).catch(() => {});
}

function buildTabSnapshot(session: Session, tabId: number): TabSnapshot {
    const tabState = session.tabs[tabId];

    const tabSnapshot: TabSnapshot = {
        cNameRequests: collectCnameCloakedRequestsForTab(session, tabId),
        dnsTrackingRequests: collectDnsTrackingRequestsForTab(session, tabId),
        // TODO(bug): tabState is undefined for tabs without recorded data, which throws here.
        frames: Object.entries(tabState!.frames).map(([frameId, frameState]) => frameSnapshotFromFrame(frameState, frameId)),
        cutoffs: settings.cutoffs,
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
        spikes: document.spikes.map((spike) => convertToMetricsSnapshot(spike.fpMetrics)).filter((metrics) => metrics !== null),
        scripts: Object.entries(document.scripts).map(([scriptName, script]) => scriptSnapshotFromScript(script, scriptName)),
    };
}

function scriptSnapshotFromScript(script: ScriptState, scriptName: string): ScriptSnapshot {
    const apiCounts: Record<string, number> = {};
    // Per API, the positions it was called from: "line:column" -> location with call count.
    const positions = new Map<string, Map<string, CallLocation>>();

    for (const event of script.fpEvents) {
        apiCounts[event.id] = (apiCounts[event.id] ?? 0) + 1;

        // == null also skips events from an older recorder, which don't have the fields at all.
        if (event.line == null || event.column == null) continue;
        const byPosition = positions.get(event.id) ?? new Map<string, CallLocation>();
        const key = `${event.line}:${event.column}`;
        const location = byPosition.get(key) ?? { line: event.line, column: event.column, generated: false, calls: 0 };
        location.calls++;
        location.generated ||= event.generated === true;
        byPosition.set(key, location);
        positions.set(event.id, byPosition);
    }

    const apiLocations: Record<string, CallLocation[]> = {};
    for (const [api, byPosition] of positions) {
        apiLocations[api] = [...byPosition.values()].sort((a, b) => b.calls - a.calls);
    }

    return {
        name: scriptName,
        fpMetrics: convertToMetricsSnapshot(script.fpMetrics),
        fpSpikes: script.fpSpikes.map(convertToSpikeSnapshot),
        apiCounts,
        apiLocations,
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
            const subdomainScore = scoreSubdomainEntropy(extractSubdomain(req.hostname), settings);
            req.subdomainScore = subdomainScore;
            if (req.subdomainScore >= settings.cutoffs.hostname.possible) {
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
        signals: fpMetrics.signals,
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
