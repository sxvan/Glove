/**
 *
 * @returns {Session}
 */
export function createSession() {
    return { dnsResults: new Map(), tabs: {} };
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @returns {TabState}
 */
export function ensureTab(session, tabId) {
    if (!session.tabs[tabId]) {
        session.tabs[tabId] = { frames: {} };
    }

    return session.tabs[tabId];
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @returns {{tab: TabState, frame: FrameState}}
 */
export function ensureFrame(session, tabId, frameId) {
    const tab = ensureTab(session, tabId);

    if (!tab.frames[frameId]) {
        tab.frames[frameId] = {
            currentDocumentId: null,
            documents: {},
        };
    }

    return { tab, frame: tab.frames[frameId] };
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @returns {boolean}
 */
export function documentExists(session, tabId, frameId, documentId) {
    const tab = session.tabs[tabId];
    if (!tab) {
        return false;
    }

    /** @type {FrameState} */
    const frame = tab.frames[frameId];
    if (!frame) {
        return false;
    }

    /** @type {DocumentState} */
    const document = frame.documents[documentId];
    return !!document;
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {string} url
 * @returns {{tab: TabState, frame: FrameState, document: DocumentState}}
 */
export function ensureDocument(session, tabId, frameId, documentId, url) {
    const { tab, frame } = ensureFrame(session, tabId, frameId);

    if (!frame.documents[documentId]) {
        frame.documents[documentId] = {
            documentId: documentId,
            currentUrl: url,
            startTime: Date.now(),
            endTime: null,
            httpRequests: [],
            scripts: {},
            spikes: [],
        };
    } else if (url !== null) {
        const document = frame.documents[documentId];
        document.currentUrl = url;
    }

    frame.currentDocumentId = documentId;

    return { tab, frame, document: frame.documents[documentId] };
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {string} url
 * @param {string} scriptUrl
 */
export function ensureScript(session, tabId, frameId, documentId, url, scriptUrl) {
    const { tab, frame, document } = ensureDocument(session, tabId, frameId, documentId, url);
    if (!document.scripts[scriptUrl]) {
        document.scripts[scriptUrl] = {
            fpEvents: [],
            httpEvents: [],
            httpConsolidatedEvents: [],
            fpSpikes: [],
        };
    }

    return { tab, frame, document, script: document.scripts[scriptUrl] };
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {string} url
 */
export function updateDocumentRoute(session, tabId, frameId, documentId, url) {
    const { document } = ensureDocument(session, tabId, frameId, documentId, url);
    if (document.currentUrl === url) {
        return;
    }

    document.currentUrl = url;
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {string} url
 */
export function updateCurrentDocument(session, tabId, frameId, documentId, url) {
    const { frame } = ensureDocument(session, tabId, frameId, documentId, url);

    const previousDocumentId = frame.currentDocumentId;

    if (!previousDocumentId) {
        frame.currentDocumentId = documentId;
        return;
    }

    if (previousDocumentId !== documentId) {
        const previousDocument = frame.documents[previousDocumentId];
        previousDocument.endTime = Date.now();
    }

    frame.currentDocumentId = documentId;
}

/**
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {string} url
 * @param {FpMonkeyEvent} event
 */
export function storeFpEvent(session, tabId, frameId, documentId, url, event) {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);

    script.fpEvents.push(event);
}

/**
 *
 * @param {Session} session
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} documentId
 * @param {string} url
 * @param {HttpMonkeyEvent} event
 */
export function storeHttpEvent(session, tabId, frameId, documentId, url, event) {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);

    script.httpEvents.push(event);
}
