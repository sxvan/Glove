import type { FpMonkeyEvent, HttpMonkeyEvent } from '@/types/events';
import type { DocumentState, FrameState, ScriptState, Session, TabState } from '@/types/session';

export function createSession(): Session {
    return { dnsResults: new Map(), tabs: {} };
}

export function ensureTab(session: Session, tabId: number): TabState {
    if (!session.tabs[tabId]) {
        session.tabs[tabId] = { frames: {} };
    }

    return session.tabs[tabId];
}

export function ensureFrame(session: Session, tabId: number, frameId: number): { tab: TabState; frame: FrameState } {
    const tab = ensureTab(session, tabId);

    if (!tab.frames[frameId]) {
        tab.frames[frameId] = {
            currentDocumentId: null,
            documents: {},
        };
    }

    return { tab, frame: tab.frames[frameId] };
}

export function documentExists(session: Session, tabId: number, frameId: number, documentId: string): boolean {
    const tab = session.tabs[tabId];
    if (!tab) {
        return false;
    }

    const frame = tab.frames[frameId];
    if (!frame) {
        return false;
    }

    const document = frame.documents[documentId];
    return !!document;
}

export function ensureDocument(
    session: Session,
    tabId: number,
    frameId: number,
    documentId: string,
    url: string | null | undefined
): { tab: TabState; frame: FrameState; document: DocumentState } {
    const { tab, frame } = ensureFrame(session, tabId, frameId);

    if (!frame.documents[documentId]) {
        frame.documents[documentId] = {
            documentId: documentId,
            currentUrl: url ?? null,
            startTime: Date.now(),
            endTime: null,
            httpRequests: [],
            scripts: {},
            spikes: [],
        };
    } else if (url !== null) {
        const document = frame.documents[documentId];
        document.currentUrl = url ?? null;
    }

    frame.currentDocumentId = documentId;

    return { tab, frame, document: frame.documents[documentId] };
}

export function ensureScript(
    session: Session,
    tabId: number,
    frameId: number,
    documentId: string,
    url: string | null | undefined,
    scriptUrl: string | null
): { tab: TabState; frame: FrameState; document: DocumentState; script: ScriptState } {
    const { tab, frame, document } = ensureDocument(session, tabId, frameId, documentId, url);
    // A null scriptUrl is stored under the key "null", as plain JS object keys always were.
    const scriptKey = String(scriptUrl);
    if (!document.scripts[scriptKey]) {
        document.scripts[scriptKey] = {
            fpEvents: [],
            httpEvents: [],
            httpConsolidatedEvents: [],
            fpSpikes: [],
        };
    }

    return { tab, frame, document, script: document.scripts[scriptKey] };
}

export function updateDocumentRoute(session: Session, tabId: number, frameId: number, documentId: string, url: string) {
    const { document } = ensureDocument(session, tabId, frameId, documentId, url);
    if (document.currentUrl === url) {
        return;
    }

    document.currentUrl = url;
}

export function updateCurrentDocument(session: Session, tabId: number, frameId: number, documentId: string, url: string) {
    const { frame } = ensureDocument(session, tabId, frameId, documentId, url);

    const previousDocumentId = frame.currentDocumentId;

    if (!previousDocumentId) {
        frame.currentDocumentId = documentId;
        return;
    }

    if (previousDocumentId !== documentId) {
        const previousDocument = frame.documents[previousDocumentId]!;
        previousDocument.endTime = Date.now();
    }

    frame.currentDocumentId = documentId;
}

/**
 * Forgets the subframes of the tab's previous page once the main frame has loaded a new one, so the
 * snapshot only shows frames of the current page. Frames whose newest document started at or after
 * `committedAt` belong to the new page already, as their events can arrive before the commit does.
 */
export function dropPreviousPageFrames(session: Session, tabId: number, committedAt: number) {
    const tab = session.tabs[tabId];
    if (!tab) return;

    for (const [frameId, frame] of Object.entries(tab.frames)) {
        if (Number(frameId) === 0) continue;
        const newest = Math.max(...Object.values(frame.documents).map((d) => d.startTime));
        if (newest < committedAt) delete tab.frames[Number(frameId)];
    }
}

export function storeFpEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | undefined, event: FpMonkeyEvent) {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);

    script.fpEvents.push(event);
}

export function storeHttpEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | undefined, event: HttpMonkeyEvent) {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);

    script.httpEvents.push(event);
}
