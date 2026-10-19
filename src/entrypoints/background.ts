import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { blockKey, loadBlocked, loadBlockingOptions, setBlocked, syncBlockingRules, watchBlocked, type BlockedScript } from '@/lib/blocking';
import { createScheduler } from '@/lib/scheduler';
import { analyzeDocumentFp } from '@/lib/fp-analysis';
import { dnsLookup } from '@/lib/dns-lookup';
import { extractSubdomain, getHostname, scoreSubdomainEntropy } from '@/lib/http-utils';
import { DEFAULT_SETTINGS, loadScoringSettings, watchScoringSettings, type ScoringSettings } from '@/lib/scoring';
import { forgetTabIcon, showScoreIcon } from '@/lib/toolbar-icon';
import { createSession, dropTab, dropPreviousPageFrames, ensureDocument, updateDocumentRoute, updateCurrentDocument, storeHttpEvent, storeFpEvent, storeStorageEvent, documentExists } from '@/lib/session-manager';
import type { FpMetrics, FpSpike, HttpRequest } from '@/types/analysis';
import type { AnalysisUpdatedMessage, GetTabSnapshotMessage, RecorderMessage, SetBlockedMessage, SetBlockedResult } from '@/types/messages';
import type { DocumentState, FrameState, ScriptState, Session } from '@/types/session';
import type { CallLocation, DocumentSnapshot, FrameSnapshot, MetricsSnapshot, ScriptSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';

const DEBOUNCE_MS = 500;
const MAX_INTERVAL_MS = 5000;

// The user's scoring settings (see lib/scoring); the defaults until they are loaded.
let settings: ScoringSettings = DEFAULT_SETTINGS;

export default defineBackground(() => {
    watchPopups();
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

    // The scripts the user blocked (see lib/blocking), by what they are blocked by; the browser's
    // rules follow the list.
    let blocked = new Set<string>();
    function applyBlocked(list: BlockedScript[]) {
        blocked = new Set(list.map((script) => script.key));
        syncBlockingRules(list).catch((error) => console.warn('Could not update the blocking rules', error));
    }
    loadBlocked().then(applyBlocked, (error) => console.warn('Could not load the blocked scripts', error));
    watchBlocked(applyBlocked);

    browser.runtime.onMessage.addListener((msg: SetBlockedMessage, _sender, sendResponse) => {
        if (msg?.type !== 'SET_BLOCKED') return;
        changeBlocked(msg).then(sendResponse, (error) => {
            console.warn('Could not block or unblock the script', error);
            sendResponse({ reloaded: false, cleared: false } satisfies SetBlockedResult);
        });
        // Answered once done.
        return true;
    });

    /**
     * Blocks a script or lets it run again, with the rules in place before the page loads again;
     * then, as the user chose, loads the tab's page again, after blocking with the site's data
     * cleared first (see reloadCleared).
     */
    async function changeBlocked({ url, blocked: block, tabId }: SetBlockedMessage): Promise<SetBlockedResult> {
        await setBlocked(url, block);
        const list = await loadBlocked();
        blocked = new Set(list.map((script) => script.key));
        await syncBlockingRules(list);
        const options = await loadBlockingOptions();
        if (tabId === null || !(options.reload || (block && options.clearData))) return { reloaded: false, cleared: false };
        if (block && options.clearData) {
            await reloadCleared(tabId, url);
            return { reloaded: true, cleared: true };
        }
        await browser.tabs.reload(tabId);
        return { reloaded: true, cleared: false };
    }

    /**
     * Loads the tab's page again with its site's data cleared: the cookies of the whole site, storage,
     * IndexedDB and caches, of the page's site and of each frame's the blocked script ran in. The old
     * page is left for an empty one first: while it runs, its scripts (the blocked one too, already
     * loaded) could store again between clearing and loading.
     */
    async function reloadCleared(tabId: number, scriptUrl: string) {
        const tab = await browser.tabs.get(tabId);
        const pageUrl = tab.url;
        if (!pageUrl || !/^https?:/.test(pageUrl)) return;
        const origins = new Set([new URL(pageUrl).origin]);
        const key = blockKey(scriptUrl);
        for (const frame of Object.values(session.tabs[tabId]?.frames ?? {})) {
            const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
            if (!document?.currentUrl || !/^https?:/.test(document.currentUrl)) continue;
            if (Object.keys(document.scripts).some((name) => blockKey(name) === key)) origins.add(new URL(document.currentUrl).origin);
        }
        await navigateAndWait(tabId, 'about:blank');
        await browser.browsingData.remove(
            // Never empty: the page's own origin is in it.
            { origins: [...origins] as [string, ...string[]] },
            { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true }
        );
        await browser.tabs.update(tabId, { url: pageUrl });
    }

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
        const top = session.tabs[tabId]?.frames['0'];
        const page = top?.currentDocumentId ? top.documents[top.currentDocumentId] : undefined;
        const pageUrl = page?.currentUrl ?? document.currentUrl;
        const httpEvent: HttpRequest = { ...details, documentUrl: document.currentUrl, pageUrl, hostname, bodyBytes: bodySize(details.requestBody) };
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

        if (msg.type === 'storage-batch') {
            for (const event of msg.payload) {
                storeStorageEvent(session, tabId, frameId, sender.documentId, sender.url, event);
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

    // A blocked script that tried to load: the browser refused it (see lib/blocking), so the page's
    // list of scripts can show it, to unblock it there.
    browser.webRequest.onErrorOccurred.addListener(
        (details) => {
            const { tabId, frameId, documentId } = details;
            if (tabId === -1 || frameId === -1 || !documentId || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
            const key = blockKey(details.url);
            if (!key || !blocked.has(key) || !documentExists(session, tabId, frameId, documentId)) return;

            const { document } = ensureDocument(session, tabId, frameId, documentId, null);
            const attempt = (document.blockedScripts[key] ??= { url: details.url, attempts: 0 });
            attempt.attempts++;
            broadcastTabSnapshot(session, tabId);
        },
        { urls: ['<all_urls>'], types: ['script'] }
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

    // A closed tab's recording is of no more use.
    browser.tabs.onRemoved.addListener((tabId) => {
        dropTab(session, tabId);
        forgetTabIcon(tabId);
    });
});

/** Loads `url` in the tab and waits until it has loaded, at most a few seconds. */
function navigateAndWait(tabId: number, url: string): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            browser.tabs.onUpdated.removeListener(listener);
            clearTimeout(timer);
            resolve();
        };
        const listener = (id: number, change: Browser.tabs.OnUpdatedInfo) => {
            if (id === tabId && change.status === 'complete') done();
        };
        const timer = setTimeout(done, 3000);
        browser.tabs.onUpdated.addListener(listener);
        browser.tabs.update(tabId, { url }).catch(done);
    });
}

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

// Open popups, each connected by a port while it is open (see the popup's App and watchPopups).
const openPopups = new Set<Browser.runtime.Port>();

function watchPopups() {
    browser.runtime.onConnect.addListener((port) => {
        if (port.name !== 'popup') return;
        openPopups.add(port);
        port.onDisconnect.addListener(() => openPopups.delete(port));
    });
}

/**
 * After an analysis: updates the tab's toolbar ring, and sends an open popup the tab's snapshot.
 * The snapshot copies all the tab has recorded, so it is only built while a popup shows it; the
 * ring needs just the page's score, read from the session.
 */
function broadcastTabSnapshot(session: Session, tabId: number) {
    showPageScore(session, tabId);
    if (openPopups.size === 0) return;
    const snapshot = buildTabSnapshot(session, tabId);
    if (!snapshot) return;
    const message: AnalysisUpdatedMessage = { type: 'ANALYSIS_UPDATED', tabId, data: snapshot };
    // Rejects when no popup is open to receive it, which is the usual case.
    browser.runtime.sendMessage(message).catch(() => {});
}

/** The page's score on the tab's toolbar ring, as the popup shows it: its most suspicious document's. */
function showPageScore(session: Session, tabId: number) {
    const frames = session.tabs[tabId]?.frames;
    if (!frames) return;
    const current = (frame: FrameState | undefined) => (frame?.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined);
    const documents = Object.values(frames).map(current).filter((document) => document !== undefined);
    const page = current(frames[0]) ?? documents[0];
    if (!page) return;
    const score = Math.max(0, ...documents.map((document) => document.fpMetrics?.score ?? 0));
    showScoreIcon(tabId, page.documentId, score, settings.cutoffs.fingerprinting);
}

/**
 * What the popup shows for a tab; undefined for a tab without recorded data, e.g. one opened before
 * the extension was (re)loaded, which the popup asks to reload.
 */
function buildTabSnapshot(session: Session, tabId: number): TabSnapshot | undefined {
    const tabState = session.tabs[tabId];
    if (!tabState) return undefined;

    const tabSnapshot: TabSnapshot = {
        cNameRequests: collectCnameCloakedRequestsForTab(session, tabId),
        dnsTrackingRequests: collectDnsTrackingRequestsForTab(session, tabId),
        frames: Object.entries(tabState.frames).map(([frameId, frameState]) => frameSnapshotFromFrame(frameState, frameId)),
        cutoffs: settings.cutoffs,
        apis: settings.apis,
        rarityPower: settings.rarityPower,
        identifiers: settings.identifiers,
        rightAfterMs: settings.bursts.requestWindowMs,
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
        startTime: document.startTime,
        fpMetrics: convertToMetricsSnapshot(document.fpMetrics),
        spikes: document.spikes.map((spike) => convertToMetricsSnapshot(spike.fpMetrics)).filter((metrics) => metrics !== null),
        scripts: Object.entries(document.scripts).map(([scriptName, script]) => scriptSnapshotFromScript(script, scriptName)),
        blockedScripts: Object.values(document.blockedScripts).map((attempt) => ({ ...attempt })),
    };
}

function scriptSnapshotFromScript(script: ScriptState, scriptName: string): ScriptSnapshot {
    // Counted as the calls arrived (see storeFpEvent).
    const apiCounts: Record<string, number> = {};
    const apiLocations: Record<string, CallLocation[]> = {};
    const apiTimes: Record<string, { first: number; last: number }> = {};
    for (const [api, calls] of Object.entries(script.calls)) {
        apiCounts[api] = calls.count;
        apiTimes[api] = { first: calls.first, last: calls.last };
        const locations = Object.values(calls.locations);
        if (locations.length > 0) apiLocations[api] = locations.map((location) => ({ ...location })).sort((a, b) => b.calls - a.calls);
    }

    return {
        name: scriptName,
        fpMetrics: convertToMetricsSnapshot(script.fpMetrics),
        fpSpikes: script.fpSpikes.map(convertToSpikeSnapshot),
        apiCounts,
        apiLocations,
        apiTimes,
        stored: Object.values(script.stored ?? {})
            .map((item) => ({ ...item }))
            .sort((a, b) => a.first - b.first),
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
