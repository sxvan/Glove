import { placeKey } from './call-stack';
import type { FpMonkeyEvent, HttpMonkeyEvent, StorageMonkeyEvent } from '@/types/events';
import type { DocumentState, FrameState, ScriptState, Session, TabState } from '@/types/session';

export function createSession(): Session {
    return { dnsResults: new Map(), tabs: {} };
}

function ensureTab(session: Session, tabId: number): TabState {
    if (!session.tabs[tabId]) {
        session.tabs[tabId] = { frames: {} };
    }

    return session.tabs[tabId];
}

function ensureFrame(session: Session, tabId: number, frameId: number): { tab: TabState; frame: FrameState } {
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
            blockedScripts: {},
        };
    } else if (url !== null) {
        const document = frame.documents[documentId];
        document.currentUrl = url ?? null;
    }

    frame.currentDocumentId = documentId;

    return { tab, frame, document: frame.documents[documentId] };
}

function ensureScript(
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
            calls: {},
            callCount: 0,
            httpEvents: [],
            httpConsolidatedEvents: [],
            fpSpikes: [],
            stored: {},
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
        const previousDocument = frame.documents[previousDocumentId];
        if (previousDocument) previousDocument.endTime = Date.now();
    }

    frame.currentDocumentId = documentId;
    dropEndedDocuments(frame, documentId);
}

// How long a frame's previous document is kept after another replaced it: its last events can
// still arrive. Kept longer it would only add up, page after page.
const ENDED_DOCUMENT_MS = 30_000;

/** Forgets the frame's documents that ended a while ago, other than `currentId`. */
function dropEndedDocuments(frame: FrameState, currentId: string) {
    const now = Date.now();
    for (const [id, document] of Object.entries(frame.documents)) {
        if (id !== currentId && document.endTime !== null && now - document.endTime > ENDED_DOCUMENT_MS) delete frame.documents[id];
    }
}

/** Forgets all a closed tab recorded. */
export function dropTab(session: Session, tabId: number) {
    delete session.tabs[tabId];
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

/**
 * Keeps a call for its script, unless the script already has `maxCalls` (see lib/limits); then it
 * is marked as capped. Whether it was kept.
 */
export function storeFpEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | undefined, event: FpMonkeyEvent, maxCalls = Infinity): boolean {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);
    if (script.callCount >= maxCalls) {
        script.capped = true;
        return false;
    }

    script.fpEvents.push(event);
    script.callCount += 1;
    const calls = (script.calls[event.id] ??= { count: 0, first: event.timeStamp, last: event.timeStamp, locations: {} });
    calls.count += 1;
    calls.first = Math.min(calls.first, event.timeStamp);
    calls.last = Math.max(calls.last, event.timeStamp);
    // == null also skips events from an older recorder, which don't have the fields at all.
    if (event.line != null && event.column != null) {
        const location = (calls.locations[placeKey(event)] ??= { line: event.line, column: event.column, generated: false, calls: 0 });
        if (event.generated && event.innerLine != null && event.innerColumn != null) location.inner = { line: event.innerLine, column: event.innerColumn };
        location.calls += 1;
        location.generated ||= event.generated === true;
    }
    return true;
}

/**
 * Stores the request for every script on its stack: a script wrapping fetch or XHR (monitoring,
 * bot protection) sits above the one that made the request, and both should see it.
 */
export function storeHttpEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | undefined, event: HttpMonkeyEvent) {
    // An older recorder only sends scriptUrl.
    const scriptUrls = event.scriptUrls?.length ? event.scriptUrls : [event.scriptUrl];
    for (const scriptUrl of scriptUrls) {
        const { script } = ensureScript(session, tabId, frameId, documentId, url, scriptUrl);
        script.httpEvents.push(event);
    }
}

/** Notes a value the script stored, keeping the latest value of each cookie or item. */
export function storeStorageEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | undefined, event: StorageMonkeyEvent) {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);
    const item = (script.stored[`${event.kind}|${event.name}`] ??= { kind: event.kind, name: event.name, value: null, expires: null, writes: 0, first: event.timeStamp, last: event.timeStamp });
    item.value = event.value;
    item.expires = event.expires;
    item.writes += 1;
    item.first = Math.min(item.first, event.timeStamp);
    item.last = Math.max(item.last, event.timeStamp);
}
