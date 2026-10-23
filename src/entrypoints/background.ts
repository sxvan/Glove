import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
    blockKey,
    blockedBy,
    DEFAULT_BLOCKING_OPTIONS,
    loadAllowed,
    loadBlocked,
    loadBlockingOptions,
    loadExempt,
    setAllowed,
    setBlocked,
    syncBlockingRules,
    watchAllowed,
    watchBlocked,
    watchBlockingOptions,
    watchExempt,
    type AllowedScript,
    type BlockedScript,
} from '@/lib/blocking';
import { DEFAULT_LIMITS, loadLimits, watchLimits } from '@/lib/limits';
import { buildEventLog, buildTabSnapshot, callsOnPage } from '@/lib/snapshot';
import { DEFAULT_PRIVACY, loadPrivacy, watchPrivacy } from '@/lib/privacy';
import { registerRecorders } from '@/lib/recorders';
import { createScheduler } from '@/lib/scheduler';
import { loadOffSites, offEntryFor, setSiteOff, switchableHost, watchOffSites, type OffSite } from '@/lib/sites';
import { analyzeDocumentFp } from '@/lib/fp-analysis';
import { dnsLookup } from '@/lib/dns-lookup';
import { getEtld1, getHostname } from '@/lib/http-utils';
import { DEFAULT_SETTINGS, loadScoringSettings, watchScoringSettings, type ScoringSettings } from '@/lib/scoring';
import { forgetTabIcon, showBlockedCount, showScoreIcon } from '@/lib/toolbar-icon';
import { createSession, currentDocument, currentDocuments, dropTab, dropPreviousPageFrames, ensureDocument, updateDocumentRoute, updateCurrentDocument, storeHttpEvent, storeFpEvent, storeStorageEvent, documentExists, notePageMade, recordingTarget } from '@/lib/session-manager';
import type { HttpRequest } from '@/types/analysis';
import type { AnalysisUpdatedMessage, GetEventLogMessage, GetTabSnapshotMessage, RecorderMessage, SetAllowedMessage, SetBlockedMessage, SetBlockedResult, SetSiteOffMessage } from '@/types/messages';
import type { DocumentState, Session } from '@/types/session';

let settings: ScoringSettings = DEFAULT_SETTINGS;
let limits = DEFAULT_LIMITS;
let privacy = DEFAULT_PRIVACY;

export default defineBackground(() => {
    watchViews();
    const session = createSession();
    const fpScheduler = createScheduler();

    const pendingLookups = new Map<string, Promise<void>>();

    function scheduleAnalysis(document: DocumentState, tabId: number) {
        fpScheduler.notify(document, () => {
            analyzeDocumentFp(document, session.dnsResults, settings);
            publishAnalysis(session, tabId);
            blockAutomatically(tabId);
        });
    }

    function reanalyzeAll() {
        for (const tabId of Object.keys(session.tabs).map(Number)) {
            for (const document of currentDocuments(session, tabId)) analyzeDocumentFp(document, session.dnsResults, settings);
            publishAnalysis(session, tabId);
        }
    }

    follow('scoring settings', loadScoringSettings, watchScoringSettings, (loaded) => {
        settings = loaded;
        reanalyzeAll();
    });
    follow('privacy options', loadPrivacy, watchPrivacy, (loaded) => (privacy = loaded));
    follow('performance limits', loadLimits, watchLimits, (loaded) => (limits = loaded));

    let blockedList: BlockedScript[] = [];
    let allowedList: AllowedScript[] = [];
    let offSites: OffSite[] = [];
    // One update at a time: an update replaces all rules by their ids, so two at once collide.
    let rulesSynced: Promise<void> = Promise.resolve();
    function syncRules() {
        rulesSynced = rulesSynced
            .then(() => syncBlockingRules(blockedList, allowedList, offSites.map(({ site }) => site)))
            .catch((error) => console.warn('Could not update the blocking rules', error));
        return rulesSynced;
    }
    function applyBlocked(list: BlockedScript[]) {
        blockedList = list;
        return syncRules();
    }
    function applyAllowed(list: AllowedScript[]) {
        allowedList = list;
        return syncRules();
    }
    function applyOffSites(sites: OffSite[]) {
        offSites = sites;
        return Promise.all([syncRules(), registerRecorders(sites).catch((error) => console.warn('Could not register the recorders', error))]);
    }
    follow('blocked scripts', loadBlocked, watchBlocked, applyBlocked);
    follow('allowed scripts', loadAllowed, watchAllowed, applyAllowed);
    follow('sites turned off', loadOffSites, watchOffSites, applyOffSites);

    function blockedOnPage(tabId: number): number {
        const keys = new Set<string>();
        for (const document of currentDocuments(session, tabId)) {
            for (const key of Object.keys(document.blockedScripts)) keys.add(key);
        }
        return keys.size;
    }

    const isOff = (url: string | null | undefined) => offEntryFor(switchableHost(url), offSites) !== undefined;
    function tabIsOff(tabId: number): boolean {
        return isOff(currentDocument(session.tabs[tabId]?.frames[0])?.currentUrl);
    }

    // The page reloads at once, with the recorders and rules already in step.
    browser.runtime.onMessage.addListener((msg: SetSiteOffMessage, _sender, sendResponse) => {
        if (msg?.type !== 'SET_SITE_OFF') return;
        (async () => {
            await setSiteOff(msg.host, msg.off);
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
        // Keeps the channel open until answered.
        return true;
    });

    let blockingOptions = DEFAULT_BLOCKING_OPTIONS;
    let exempt = new Set<string>();
    follow('blocking options', loadBlockingOptions, watchBlockingOptions, (loaded) => (blockingOptions = loaded));
    follow('exempt scripts', loadExempt, watchExempt, (keys) => (exempt = new Set(keys)));

    // Being blocked now, so analyses meanwhile don't block them again.
    const autoBlocking = new Set<string>();

    // All at once, for one reload and one clearing.
    function blockAutomatically(tabId: number) {
        if (!blockingOptions.autoBlock || tabIsOff(tabId)) return;
        const found = new Map<string, number>();
        for (const document of currentDocuments(session, tabId)) {
            for (const [name, script] of Object.entries(document.scripts)) {
                const score = script.fpMetrics?.score ?? 0;
                const key = blockKey(name);
                if (score < blockingOptions.autoBlockFrom || !key || blockedBy(name, blockedList, allowedList) || allowedList.some((script) => script.key === key) || exempt.has(key) || autoBlocking.has(key)) continue;
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
        return true;
    });

    browser.runtime.onMessage.addListener((msg: SetAllowedMessage, _sender, sendResponse) => {
        if (msg?.type !== 'SET_ALLOWED') return;
        (async (): Promise<SetBlockedResult> => {
            await setAllowed([msg.url], true);
            await applyAllowed(await loadAllowed());
            if (msg.tabId === null || !(await loadBlockingOptions()).reload) return { reloaded: false, cleared: false };
            await browser.tabs.reload(msg.tabId);
            return { reloaded: true, cleared: false };
        })().then(sendResponse, (error) => {
            console.warn('Could not allow the script', error);
            sendResponse({ reloaded: false, cleared: false } satisfies SetBlockedResult);
        });
        return true;
    });

    /** `auto`: the scores of scripts blocked automatically, by URL. */
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

    // The page's origin and those of the frames a blocked script ran in. The page is left for an empty
    // one first, or its scripts (the blocked one too) could store again between clearing and loading.
    async function reloadCleared(tabId: number, scriptUrls: string[]) {
        const tab = await browser.tabs.get(tabId);
        const pageUrl = tab.url;
        if (!pageUrl || !/^https?:/.test(pageUrl)) return;
        const origins = new Set([new URL(pageUrl).origin]);
        const keys = new Set(scriptUrls.map(blockKey));
        for (const document of currentDocuments(session, tabId)) {
            if (!document.currentUrl || !/^https?:/.test(document.currentUrl)) continue;
            if (Object.keys(document.scripts).some((name) => keys.has(blockKey(name)))) origins.add(new URL(document.currentUrl).origin);
        }
        await navigateAndWait(tabId, 'about:blank');
        await browser.browsingData.remove(
            { origins: [...origins] as [string, ...string[]] },
            { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true }
        );
        await browser.tabs.update(tabId, { url: pageUrl });
    }

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

        const { frameId, documentId } = recordingTarget(session, tabId, requestFrameId, requestDocumentId);

        if (!documentExists(session, tabId, frameId, documentId)) {
            return;
        }

        const { document } = ensureDocument(session, tabId, frameId, documentId, null);
        if (!document) return;

        const hostname = getHostname(details.url);
        const page = currentDocument(session.tabs[tabId]?.frames[0]);
        const pageUrl = page?.currentUrl ?? document.currentUrl;
        // A page loading counts by its own address.
        if (isOff(details.type === 'main_frame' ? details.url : pageUrl)) return;
        // Only the body's size: the raw bytes of every request would add up.
        const { requestBody, ...request } = details;
        const httpEvent: HttpRequest = { ...request, documentUrl: document.currentUrl, pageUrl, hostname, bodyBytes: bodySize(requestBody) };
        document.httpRequests.push(httpEvent);

        scheduleAnalysis(document, tabId);

        // Only a host of the page's own site can be cloaked (see isCnameCloaked), so only those are
        // looked up: the resolver learns the site visited, not every tracker it loads.
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

        // By the tab's page, so frames of other sites in it are off too.
        if (isOff(sender.tab.url)) return;

        const tabId = sender.tab.id!;
        const { frameId, documentId } = recordingTarget(session, tabId, sender.frameId!, sender.documentId);
        const url = documentId === sender.documentId ? sender.url : null;
        const { document } = ensureDocument(session, tabId, frameId, documentId, url);

        if (msg.type === 'fp-batch') {
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
            if (pageCalls >= limits.callsPerPage) {
                sendResponse({ stop: true });
                publishAnalysis(session, tabId);
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
            const snapshot = buildTabSnapshot(session, tabId, settings, limits);
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

    browser.webRequest.onErrorOccurred.addListener(
        (details) => {
            const { tabId } = details;
            if (tabId === -1 || details.frameId === -1 || !details.documentId || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
            const entry = blockedBy(details.url, blockedList, allowedList);
            const { frameId, documentId } = recordingTarget(session, tabId, details.frameId, details.documentId);
            if (!entry || !documentExists(session, tabId, frameId, documentId)) return;

            const { document } = ensureDocument(session, tabId, frameId, documentId, null);
            const attempt = (document.blockedScripts[blockKey(details.url)!] ??= { key: entry.key, url: details.url, attempts: 0 });
            attempt.attempts++;
            showBlockedCount(tabId, blockedOnPage(tabId));
            publishAnalysis(session, tabId);
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
            showBlockedCount(tabId, 0);
        }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
        dropTab(session, tabId);
        forgetTabIcon(tabId);
    });
});

// A change seen while loading is newer than what the load read, so the load doesn't overwrite it.
function follow<T>(name: string, load: () => Promise<T>, watch: (onChange: (value: T) => void) => unknown, apply: (value: T) => unknown) {
    let changed = false;
    load().then(
        (loaded) => {
            if (!changed) apply(loaded);
        },
        (error) => console.warn(`Could not load the ${name}; using the defaults`, error)
    );
    watch((value) => {
        changed = true;
        apply(value);
    });
}

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

function bodySize(body: Browser.webRequest.OnBeforeRequestDetails['requestBody']): number {
    if (!body) return 0;
    let bytes = 0;
    for (const part of body.raw ?? []) bytes += part.bytes?.byteLength ?? 0;
    for (const [name, values] of Object.entries(body.formData ?? {})) {
        for (const value of values) bytes += name.length + String(value).length + 2; // name=value&
    }
    return bytes;
}

// Popups and dashboards, connected by a port named 'view' while open.
const openViews = new Set<Browser.runtime.Port>();

function watchViews() {
    browser.runtime.onConnect.addListener((port) => {
        if (port.name !== 'view') return;
        openViews.add(port);
        port.onDisconnect.addListener(() => openViews.delete(port));
    });
}

// A snapshot copies all the tab recorded, so it is only built while a view is open.
function publishAnalysis(session: Session, tabId: number) {
    showPageScore(session, tabId);
    if (openViews.size === 0) return;
    const snapshot = buildTabSnapshot(session, tabId, settings, limits);
    if (!snapshot) return;
    const message: AnalysisUpdatedMessage = { type: 'ANALYSIS_UPDATED', tabId, data: snapshot };
    // Rejects when no view listens.
    browser.runtime.sendMessage(message).catch(() => {});
}

function showPageScore(session: Session, tabId: number) {
    const documents = currentDocuments(session, tabId);
    const page = currentDocument(session.tabs[tabId]?.frames[0]) ?? documents[0];
    if (!page) return;
    const score = Math.max(0, ...documents.map((document) => document.fpMetrics?.score ?? 0));
    showScoreIcon(tabId, page.documentId, score, settings.cutoffs.fingerprinting);
}
