import { createScheduler } from '../common/scheduler.js';
import { analyzeDocumentFp } from '../common/fp-analysis.js';
import { dnsLookup } from '../common/dns-lookup.js';
import { extractSubdomain, getHostname, scoreSubdomainEntropy } from '../common/http-utils.js';
import { createSession, ensureDocument, updateDocumentRoute, updateCurrentDocument, storeHttpEvent, storeFpEvent, documentExists } from '../common/session-manager.js';

const session = createSession();
const DEBOUNCE_MS = 500;
const MAX_INTERVAL_MS = 5000;

const fpScheduler = createScheduler({ debounceMs: DEBOUNCE_MS, maxIntervalMs: MAX_INTERVAL_MS });

/**
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {any} httpEvent
 */
function storeHttpRequest(tabId, frameId, documentId, httpEvent) {
    if (httpEvent.url.startsWith('chrome-extension://')) {
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

    const hostname = getHostname(httpEvent.url);
    if (!session.dnsResults.has(hostname)) {
        dnsLookup(hostname).then((dnsResponse) => {
            session.dnsResults.set(hostname, dnsResponse);
        });
    }

    httpEvent.documentUrl = document.currentUrl;
    httpEvent.hostname = hostname;
    document.httpRequests.push(httpEvent);

    fpScheduler.notify(document.documentId, () => {
        analyzeDocumentFp(document, session.dnsResults);
        broadcastTabSnapshot(tabId);
    });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!sender.tab || sender.tab.id === -1 || sender.frameId === -1 || !sender.documentId) {
        return;
    }

    if (!msg || !msg.type || !msg.payload) {
        return;
    }

    const { document } = ensureDocument(session, sender.tab.id, sender.frameId, sender.documentId, sender.url);

    if (msg.type === 'fp') {
        /** @type {FpMonkeyEvent} */
        const fpEvent = msg.payload;
        storeFpEvent(session, sender.tab.id, sender.frameId, sender.documentId, sender.url, fpEvent);

        fpScheduler.notify(document.documentId, () => {
            analyzeDocumentFp(document, session.dnsResults);
            broadcastTabSnapshot(sender.tab.id);
        });
        return;
    }

    if (msg.type === 'http') {
        /** @type {HttpMonkeyEvent} */
        const httpEvent = msg.payload;
        storeHttpEvent(session, sender.tab.id, sender.frameId, sender.documentId, sender.url, httpEvent);

        fpScheduler.notify(document.documentId, () => {
            analyzeDocumentFp(document, session.dnsResults);
            broadcastTabSnapshot(sender.tab.id);
        });
        return;
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_TAB_SNAPSHOT') {
        const tabId = Number(msg.tabId);
        const snapshot = buildTabSnapshot(session, tabId);
        sendResponse(snapshot);
        return;
    }
});

chrome.webRequest.onBeforeRequest.addListener(
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

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    const { tabId, frameId, url, documentId } = details;

    if (tabId === -1 || frameId === -1 || !documentId) {
        return;
    }

    updateDocumentRoute(session, tabId, frameId, documentId, url);
});

chrome.webNavigation.onCommitted.addListener((details) => {
    const { tabId, frameId, url, documentId } = details;

    if (tabId === -1 || frameId === -1 || !documentId) {
        return;
    }

    updateCurrentDocument(session, tabId, frameId, documentId, url);
});

function broadcastTabSnapshot(tabId) {
    const snapshot = buildTabSnapshot(session, tabId);
    console.log('Broadcasting snapshot for tab', tabId, snapshot);
    chrome.runtime.sendMessage({ type: 'ANALYSIS_UPDATED', tabId, data: snapshot });
}

/**
 * @param {Session} session
 * @param {number} tabId
 */
function buildTabSnapshot(session, tabId) {
    const tabState = session.tabs[tabId];

    /** @type {TabSnapshot} */
    const tabSnapshot = {
        cNameRequests: collectCnameCloakedRequestsForTab(session, tabId),
        dnsTrackingRequests: collectDnsTrackingRequestsForTab(session, tabId),
        frames: Object.entries(tabState.frames).map(([frameId, frameState]) => frameSnapshotFromFrame(frameState, frameId)),
    };

    return tabSnapshot;
}

/**
 *
 * @param {FrameState} frame
 * @param {string} frameId
 * @returns {FrameSnapshot}
 */
function frameSnapshotFromFrame(frame, frameId) {
    const document = frame.documents[frame.currentDocumentId];

    if (!document) {
        console.warn('No current document for frame', frameId);
        return null;
    }

    return {
        frameId: frameId,
        document: documentSnapshotFromDocument(document),
    };
}

/**
 *
 * @param {DocumentState} document
 * @returns {DocumentSnapshot}
 */
function documentSnapshotFromDocument(document) {
    return {
        documentId: document.documentId,
        url: document.currentUrl,
        fpMetrics: convertToMetricsSnapshot(document.fpMetrics),
        scripts: Object.entries(document.scripts).map(([scriptName, script]) => scriptSnapshotFromScript(script, scriptName)),
    };
}

/**
 * @param {ScriptState} script
 * @param {string} scriptName
 * @returns {ScriptSnapshot}
 */
function scriptSnapshotFromScript(script, scriptName) {
    return {
        name: scriptName,
        fpMetrics: convertToMetricsSnapshot(script.fpMetrics),
        fpSpikes: script.fpSpikes.map(convertToSpikeSnapshot),
    };
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @returns {HttpRequest[]}
 */
export function collectCnameCloakedRequestsForTab(session, tabId) {
    const tab = session.tabs[tabId];
    if (!tab) return [];

    /** @type {HttpRequest[]} */
    const results = [];

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

/**
 * @param {Session} session
 * @param {number} tabId
 * @returns {HttpRequest[]}
 */
export function collectDnsTrackingRequestsForTab(session, tabId) {
    const tab = session.tabs[tabId];
    if (!tab) return [];

    /** @type {HttpRequest[]} */
    const results = [];

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

/**
 *
 * @param {FpMetrics} fpMetrics
 * @returns {MetricsSnapshot}
 */
function convertToMetricsSnapshot(fpMetrics) {
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

function convertToSpikeSnapshot(fpSpike) {
    if (!fpSpike) {
        return null;
    }
    return {
        events: fpSpike.events,
        fpMetrics: convertToMetricsSnapshot(fpSpike.fpMetrics),
        httpCorrelations: fpSpike.httpCorrelations,
    };
}
