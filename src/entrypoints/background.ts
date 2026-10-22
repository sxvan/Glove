import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
    blockKey,
    DEFAULT_BLOCKING_OPTIONS,
    loadBlocked,
    loadBlockingOptions,
    loadExempt,
    setBlocked,
    syncBlockingRules,
    watchBlocked,
    watchBlockingOptions,
    watchExempt,
    type BlockedScript,
} from '@/lib/blocking';
import { DEFAULT_LIMITS, loadLimits, watchLimits } from '@/lib/limits';
import { DEFAULT_PRIVACY, loadPrivacy, watchPrivacy } from '@/lib/privacy';
import { registerRecorders } from '@/lib/recorders';
import { createScheduler } from '@/lib/scheduler';
import { loadOffSites, offEntryFor, setSiteOff, switchableHost, watchOffSites, type OffSite } from '@/lib/sites';
import { analyzeDocumentFp } from '@/lib/fp-analysis';
import { dnsLookup } from '@/lib/dns-lookup';
import { carriesData } from '@/lib/http-analysis';
import { getEtld1, getHostname } from '@/lib/http-utils';
import { DEFAULT_SETTINGS, loadScoringSettings, watchScoringSettings, type ScoringSettings } from '@/lib/scoring';
import { forgetTabIcon, showBlockedCount, showScoreIcon } from '@/lib/toolbar-icon';
import { createSession, dropTab, dropPreviousPageFrames, ensureDocument, updateDocumentRoute, updateCurrentDocument, storeHttpEvent, storeFpEvent, storeStorageEvent, documentExists, notePageMade, recordingTarget } from '@/lib/session-manager';
import type { FpMetrics, FpSpike, HttpRequest } from '@/types/analysis';
import type { AnalysisUpdatedMessage, GetEventLogMessage, GetTabSnapshotMessage, RecorderMessage, SetBlockedMessage, SetBlockedResult, SetSiteOffMessage } from '@/types/messages';
import type { DocumentState, FrameState, ScriptState, Session } from '@/types/session';
import type { CallLocation, EventLog, EventLogEntry, DocumentSnapshot, FrameSnapshot, MetricsSnapshot, ScriptSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';

const DEBOUNCE_MS = 500;
const MAX_INTERVAL_MS = 5000;

// The user's scoring settings (see lib/scoring); the defaults until they are loaded.
let settings: ScoringSettings = DEFAULT_SETTINGS;
// How many calls are kept (see lib/limits); the defaults until they are loaded.
let limits = DEFAULT_LIMITS;
// What may be sent off the browser (see lib/privacy); the defaults until they are loaded.
let privacy = DEFAULT_PRIVACY;

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
            blockAutomatically(tabId);
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
    let privacyChanged = false;
    loadPrivacy().then((loaded) => {
        if (!privacyChanged) privacy = loaded;
    });
    watchPrivacy((changed) => {
        privacyChanged = true;
        privacy = changed;
    });
    let limitsChanged = false;
    loadLimits().then((loaded) => {
        if (!limitsChanged) limits = loaded;
    });
    watchLimits((changed) => {
        limitsChanged = true;
        limits = changed;
    });

    // The scripts the user blocked (see lib/blocking), by what they are blocked by, and the sites the
    // extension is off for (see lib/sites); the browser's rules and the registered recorders follow
    // them.
    let blockedList: BlockedScript[] = [];
    let blocked = new Set<string>();
    let offSites: OffSite[] = [];
    let offSitesChanged = false;
    function syncRules() {
        return syncBlockingRules(
            blockedList,
            offSites.map(({ site }) => site)
        ).catch((error) => console.warn('Could not update the blocking rules', error));
    }
    function applyBlocked(list: BlockedScript[]) {
        blockedList = list;
        blocked = new Set(list.map((script) => script.key));
        return syncRules();
    }
    function applyOffSites(sites: OffSite[]) {
        offSites = sites;
        return Promise.all([syncRules(), registerRecorders(sites).catch((error) => console.warn('Could not register the recorders', error))]);
    }
    loadBlocked().then(applyBlocked, (error) => console.warn('Could not load the blocked scripts', error));
    watchBlocked(applyBlocked);
    loadOffSites().then((sites) => {
        if (!offSitesChanged) applyOffSites(sites);
    });
    watchOffSites((sites) => {
        offSitesChanged = true;
        applyOffSites(sites);
    });

    /** How many different blocked scripts tried to load on the tab's page, in all its frames. */
    function blockedOnPage(tabId: number): number {
        const keys = new Set<string>();
        for (const frame of Object.values(session.tabs[tabId]?.frames ?? {})) {
            const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
            for (const key of Object.keys(document?.blockedScripts ?? {})) keys.add(key);
        }
        return keys.size;
    }

    /** Whether the extension is off for the page at `url` (see lib/sites). */
    const isOff = (url: string | null | undefined) => offEntryFor(switchableHost(url), offSites) !== undefined;
    /** Whether it is off for the page in the tab, by its top document. */
    function tabIsOff(tabId: number): boolean {
        const top = session.tabs[tabId]?.frames[0];
        return isOff(top?.currentDocumentId ? top.documents[top.currentDocumentId]?.currentUrl : null);
    }

    /**
     * Turns the extension off on a tab's site or on again, with the recorders and rules in step
     * before the page loads again, which it does at once: off, the recording made so far goes.
     */
    browser.runtime.onMessage.addListener((msg: SetSiteOffMessage, _sender, sendResponse) => {
        if (msg?.type !== 'SET_SITE_OFF') return;
        (async () => {
            await setSiteOff(msg.host, msg.off);
            offSitesChanged = true;
            await applyOffSites(await loadOffSites());
            if (msg.off) {
                dropTab(session, msg.tabId);
                forgetTabIcon(msg.tabId);
            }
            await browser.tabs.reload(msg.tabId);
        })().then(
            () => sendResponse(true),
            (error) => {
                console.warn('Could not turn the extension off or on for the site', error);
                sendResponse(false);
            }
        );
        // Answered once done.
        return true;
    });

    // What to do after blocking, and the scripts never to block automatically (see lib/blocking).
    // A change seen while loading is newer than what the load read, so the load doesn't overwrite it.
    let blockingOptions = DEFAULT_BLOCKING_OPTIONS;
    let exempt = new Set<string>();
    let optionsChanged = false;
    let exemptChanged = false;
    loadBlockingOptions().then((loaded) => {
        if (!optionsChanged) blockingOptions = loaded;
    });
    watchBlockingOptions((changed) => {
        optionsChanged = true;
        blockingOptions = changed;
    });
    loadExempt().then((keys) => {
        if (!exemptChanged) exempt = new Set(keys);
    });
    watchExempt((keys) => {
        exemptChanged = true;
        exempt = new Set(keys);
    });

    // Scripts being blocked automatically: analyses meanwhile don't block them again.
    const autoBlocking = new Set<string>();

    /**
     * If the user chose so, blocks every script of the tab that reached the score set, as the switch
     * would, all of them at once: one reload, one clearing. Not those that can't be blocked by address,
     * are blocked already, or that the user let run again.
     */
    function blockAutomatically(tabId: number) {
        if (!blockingOptions.autoBlock || tabIsOff(tabId)) return;
        const found = new Map<string, number>();
        for (const frame of Object.values(session.tabs[tabId]?.frames ?? {})) {
            const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
            for (const [name, script] of Object.entries(document?.scripts ?? {})) {
                const score = script.fpMetrics?.score ?? 0;
                const key = blockKey(name);
                if (score < blockingOptions.autoBlockFrom || !key || blocked.has(key) || exempt.has(key) || autoBlocking.has(key)) continue;
                found.set(name, score);
            }
        }
        if (found.size === 0) return;
        const keys = [...found.keys()].map((name) => blockKey(name)!);
        for (const key of keys) autoBlocking.add(key);
        changeBlocked([...found.keys()], true, tabId, found)
            .catch((error) => console.warn('Could not block scripts automatically', error))
            .finally(() => keys.forEach((key) => autoBlocking.delete(key)));
    }

    browser.runtime.onMessage.addListener((msg: SetBlockedMessage, _sender, sendResponse) => {
        if (msg?.type !== 'SET_BLOCKED') return;
        changeBlocked([msg.url], msg.blocked, msg.tabId).then(sendResponse, (error) => {
            console.warn('Could not block or unblock the script', error);
            sendResponse({ reloaded: false, cleared: false } satisfies SetBlockedResult);
        });
        // Answered once done.
        return true;
    });

    /**
     * Blocks scripts or lets them run again, with the rules in place before the page loads again;
     * then, as the user chose, loads the tab's page again, after blocking with the site's data
     * cleared first (see reloadCleared). `auto`: the scores of scripts blocked automatically, by URL.
     */
    async function changeBlocked(urls: string[], block: boolean, tabId: number | null, auto?: Map<string, number>): Promise<SetBlockedResult> {
        await setBlocked(urls, block, auto);
        await applyBlocked(await loadBlocked());
        const options = await loadBlockingOptions();
        if (tabId === null || !(options.reload || (block && options.clearData))) return { reloaded: false, cleared: false };
        if (block && options.clearData) {
            await reloadCleared(tabId, urls);
            return { reloaded: true, cleared: true };
        }
        await browser.tabs.reload(tabId);
        return { reloaded: true, cleared: false };
    }

    /**
     * Loads the tab's page again with its site's data cleared: the cookies of the whole site, storage,
     * IndexedDB and caches, of the page's site and of each frame's a blocked script ran in. The old
     * page is left for an empty one first: while it runs, its scripts (the blocked one too, already
     * loaded) could store again between clearing and loading.
     */
    async function reloadCleared(tabId: number, scriptUrls: string[]) {
        const tab = await browser.tabs.get(tabId);
        const pageUrl = tab.url;
        if (!pageUrl || !/^https?:/.test(pageUrl)) return;
        const origins = new Set([new URL(pageUrl).origin]);
        const keys = new Set(scriptUrls.map(blockKey));
        for (const frame of Object.values(session.tabs[tabId]?.frames ?? {})) {
            const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
            if (!document?.currentUrl || !/^https?:/.test(document.currentUrl)) continue;
            if (Object.keys(document.scripts).some((name) => keys.has(blockKey(name)))) origins.add(new URL(document.currentUrl).origin);
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

    function storeHttpRequest(tabId: number, requestFrameId: number, requestDocumentId: string, details: Browser.webRequest.OnBeforeRequestDetails) {
        if (details.url.startsWith('chrome-extension://')) {
            return;
        }

        // A request of a frame the page made is recorded with the document that made it, as its calls are.
        const { frameId, documentId } = recordingTarget(session, tabId, requestFrameId, requestDocumentId);

        if (!documentExists(session, tabId, frameId, documentId)) {
            return;
        }

        const { document } = ensureDocument(session, tabId, frameId, documentId, null);
        if (!document) return;

        const hostname = getHostname(details.url);
        const top = session.tabs[tabId]?.frames['0'];
        const page = top?.currentDocumentId ? top.documents[top.currentDocumentId] : undefined;
        const pageUrl = page?.currentUrl ?? document.currentUrl;
        // Nothing is recorded on a site the extension is off for: a page loading counts by its own address.
        if (isOff(details.type === 'main_frame' ? details.url : pageUrl)) return;
        const httpEvent: HttpRequest = { ...details, documentUrl: document.currentUrl, pageUrl, hostname, bodyBytes: bodySize(details.requestBody) };
        document.httpRequests.push(httpEvent);

        scheduleAnalysis(document, tabId);

        // Analyze again once the host's DNS result arrives, so the request gets its CNAME details. Only
        // a host of the page's own site, other than the page's, can hide another company behind an
        // alias (see isCnameCloaked), so only those are looked up: the resolver learns no more than
        // the site visited, not every tracker it loads.
        const pageHost = getHostname(pageUrl);
        const cloakable = hostname !== null && hostname !== pageHost && getEtld1(hostname) === getEtld1(pageHost);
        if (privacy.dnsLookups && hostname && cloakable && details.type !== 'main_frame' && !session.dnsResults.has(hostname)) {
            lookUpHost(hostname).then(
                () => scheduleAnalysis(document, tabId),
                (error) => console.warn('DNS lookup failed', hostname, error)
            );
        }
    }

    browser.runtime.onMessage.addListener((msg: RecorderMessage, sender, sendResponse) => {
        if (!sender.tab || sender.tab.id === -1 || sender.frameId === -1 || !sender.documentId) {
            return;
        }

        if (!msg || !msg.type || !msg.payload) {
            return;
        }

        // Nothing is recorded on a site the extension is off for, also from frames of other sites in it.
        if (isOff(sender.tab.url)) return;

        const tabId = sender.tab.id!;
        // A frame the page made is recorded with the document that made it (see recordingTarget),
        // which keeps its own address.
        const { frameId, documentId } = recordingTarget(session, tabId, sender.frameId!, sender.documentId);
        const url = documentId === sender.documentId ? sender.url : null;
        const { document } = ensureDocument(session, tabId, frameId, documentId, url);

        if (msg.type === 'fp-batch') {
            // Up to the limits (see lib/limits): what wasn't kept isn't scored again either.
            let pageCalls = callsOnPage(session, tabId);
            let kept = 0;
            for (const fpEvent of msg.payload) {
                if (pageCalls >= limits.callsPerPage) break;
                if (storeFpEvent(session, tabId, frameId, documentId, url, fpEvent, limits.callsPerScript)) {
                    kept++;
                    pageCalls++;
                }
            }

            if (kept > 0) scheduleAnalysis(document, tabId);
            // Past the page's limit, the bridge stops sending its calls.
            if (pageCalls >= limits.callsPerPage) {
                sendResponse({ stop: true });
                broadcastTabSnapshot(session, tabId);
            }
            return;
        }

        if (msg.type === 'storage-batch') {
            for (const event of msg.payload) {
                storeStorageEvent(session, tabId, frameId, documentId, url, event);
            }

            scheduleAnalysis(document, tabId);
            return;
        }

        if (msg.type === 'http') {
            storeHttpEvent(session, tabId, frameId, documentId, url, msg.payload);

            scheduleAnalysis(document, tabId);
            return;
        }
    });

    browser.runtime.onMessage.addListener((msg: GetTabSnapshotMessage | GetEventLogMessage, sender, sendResponse) => {
        if (msg.type === 'GET_TAB_SNAPSHOT') {
            const tabId = Number(msg.tabId);
            const snapshot = buildTabSnapshot(session, tabId);
            sendResponse(snapshot);
            return;
        }
        if (msg.type === 'GET_EVENT_LOG') {
            sendResponse(buildEventLog(session, Number(msg.tabId)));
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
            const { tabId } = details;
            if (tabId === -1 || details.frameId === -1 || !details.documentId || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
            const key = blockKey(details.url);
            const { frameId, documentId } = recordingTarget(session, tabId, details.frameId, details.documentId);
            if (!key || !blocked.has(key) || !documentExists(session, tabId, frameId, documentId)) return;

            const { document } = ensureDocument(session, tabId, frameId, documentId, null);
            const attempt = (document.blockedScripts[key] ??= { url: details.url, attempts: 0 });
            attempt.attempts++;
            showBlockedCount(tabId, blockedOnPage(tabId));
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
        const parent = details.parentFrameId >= 0 && details.parentDocumentId ? { frameId: details.parentFrameId, documentId: details.parentDocumentId } : null;
        notePageMade(session, tabId, frameId, documentId, url, parent);
        if (frameId === 0) {
            dropPreviousPageFrames(session, tabId, details.timeStamp);
            // A new page has blocked nothing yet.
            showBlockedCount(tabId, 0);
        }
    });

    // A closed tab's recording is of no more use.
    browser.tabs.onRemoved.addListener((tabId) => {
        dropTab(session, tabId);
        forgetTabIcon(tabId);
    });
});

/** How many calls the tab's page made, all its frames together, as kept (see lib/limits). */
function callsOnPage(session: Session, tabId: number): number {
    let calls = 0;
    for (const frame of Object.values(session.tabs[tabId]?.frames ?? {})) {
        const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
        for (const script of Object.values(document?.scripts ?? {})) calls += script.callCount;
    }
    return calls;
}

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
        frames: Object.entries(tabState.frames).map(([frameId, frameState]) => frameSnapshotFromFrame(frameState, frameId)),
        cutoffs: settings.cutoffs,
        apis: settings.apis,
        rarityPower: settings.rarityPower,
        callsCapped: callsOnPage(session, tabId) >= limits.callsPerPage,
        identifiers: settings.identifiers,
        rightAfterMs: settings.bursts.requestWindowMs,
    };

    return tabSnapshot;
}

/**
 * The tab's recorded events, of the documents its snapshot shows (each frame's current one), in
 * time order. A request counts for every script on its stack (see storeHttpEvent), so it is in each
 * of their lists: here it is once, for the script that made the call.
 */
function buildEventLog(session: Session, tabId: number): EventLog | undefined {
    const frames = session.tabs[tabId]?.frames;
    if (!frames) return undefined;
    const entries: EventLogEntry[] = [];
    const requests = new Set<object>();
    let startTime: number | null = null;
    for (const [frameId, frame] of Object.entries(frames)) {
        const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
        if (!document) continue;
        if (frameId === '0') startTime = document.startTime;
        for (const [script, state] of Object.entries(document.scripts)) {
            // Bursts are runs of the script's own calls (see detectSpikes), in time order.
            const burstOf = new Map<object, number>();
            state.fpSpikes.forEach((spike, i) => spike.events.forEach((event) => burstOf.set(event, i + 1)));
            for (const event of state.fpEvents) {
                entries.push({ kind: 'api', frameId, script, time: event.timeStamp, api: event.id, line: event.line, column: event.column, generated: event.generated, burst: burstOf.get(event) ?? null });
            }
            for (const event of state.httpEvents) {
                if (requests.has(event)) continue;
                requests.add(event);
                entries.push({ kind: 'request', frameId, script: String(event.scriptUrls?.[0] ?? event.scriptUrl), time: event.timeStamp, how: event.id, method: event.method, url: event.requestUrl });
            }
            for (const item of Object.values(state.stored)) {
                entries.push({ kind: 'stored', frameId, script, time: item.first, storage: item.kind, name: item.name, writes: item.writes });
            }
        }
    }
    return { startTime, entries: entries.sort((a, b) => a.time - b.time) };
}

function frameSnapshotFromFrame(frame: FrameState, frameId: string): FrameSnapshot | null {
    const document = frame.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;

    if (!document) return null;

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
        capped: script.capped === true,
        requests: script.httpConsolidatedEvents.filter(carriesData),
        // Those of its requests with data: "sent data through an alias", as the score counts them.
        cloakedHosts: [
            ...new Set(
                script.httpConsolidatedEvents
                    .filter((request) => request.httpRequest?.isCnameCloaked && request.httpRequest.hostname && carriesData(request))
                    .map(({ httpRequest }) => httpRequest.hostname!)
            ),
        ],
        stored: Object.values(script.stored ?? {})
            .map((item) => ({ ...item }))
            .sort((a, b) => a.first - b.first),
    };
}

function collectCnameCloakedRequestsForTab(session: Session, tabId: number): HttpRequest[] {
    const tab = session.tabs[tabId];
    if (!tab) return [];

    const results: HttpRequest[] = [];

    for (const frame of Object.values(tab.frames)) {
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

function convertToMetricsSnapshot(fpMetrics: FpMetrics | null | undefined): MetricsSnapshot | null {
    if (!fpMetrics) {
        return null;
    }

    return {
        distinctFpApis: Array.from(fpMetrics.distinctFpApis),
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
