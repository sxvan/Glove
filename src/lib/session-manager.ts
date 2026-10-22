import { placeKey } from './call-stack';
import type { FpMonkeyEvent, HttpMonkeyEvent, StorageMonkeyEvent } from '@/types/events';
import type { DocumentRef, DocumentState, FrameState, ScriptState, Session, TabState } from '@/types/session';

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

/** The document a frame shows now, if any. */
export function currentDocument(frame: FrameState | undefined): DocumentState | undefined {
    return frame?.currentDocumentId ? frame.documents[frame.currentDocumentId] : undefined;
}

/** The documents a tab's frames show now: its page's. */
export function currentDocuments(session: Session, tabId: number): DocumentState[] {
    return Object.values(session.tabs[tabId]?.frames ?? {})
        .map(currentDocument)
        .filter((document) => document !== undefined);
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

    // The first document seen in a frame is its current one; after that, only a page load changes it
    // (see updateCurrentDocument), so a late event of the previous page doesn't bring it back.
    frame.currentDocumentId ??= documentId;

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
    // Calls without a script (e.g. from the console) are kept under "null".
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
    ensureDocument(session, tabId, frameId, documentId, url).document.currentUrl = url;
}

export function updateCurrentDocument(session: Session, tabId: number, frameId: number, documentId: string, url: string) {
    const previousDocumentId = session.tabs[tabId]?.frames[frameId]?.currentDocumentId ?? null;
    const { frame } = ensureDocument(session, tabId, frameId, documentId, url);
    if (previousDocumentId && previousDocumentId !== documentId) {
        const previousDocument = frame.documents[previousDocumentId];
        if (previousDocument) previousDocument.endTime = Date.now();
    }
    frame.currentDocumentId = documentId;
    dropEndedDocuments(frame, documentId);
}

// How long a frame's previous document is kept at least after another replaced it, as its last
// events can still arrive; it goes as the frame loads a document after that. Kept longer it would
// only add up, page after page.
const ENDED_DOCUMENT_MS = 30_000;

/** Forgets the frame's documents that ended a while ago, other than `currentId`. */
function dropEndedDocuments(frame: FrameState, currentId: string) {
    const now = Date.now();
    for (const [id, document] of Object.entries(frame.documents)) {
        if (id !== currentId && document.endTime !== null && now - document.endTime > ENDED_DOCUMENT_MS) delete frame.documents[id];
    }
}

// Addresses of documents a page makes itself rather than loads: a blank frame, its srcdoc, and
// data: and blob: URLs.
const PAGE_MADE = /^(about|data|blob):/i;

/**
 * Notes, as a frame commits a new document, which document made it if the page made it itself
 * (see PAGE_MADE): the one of the frame above it, `parent`. Its scripts made it, often only to read
 * from it, so what happens in it belongs to them. The recorders already hand over what happens in
 * frames the page can reach (see lib/recording-document); this joins those they can't, data: and
 * sandboxed frames, which always commit with their parent.
 */
export function notePageMade(session: Session, tabId: number, frameId: number, documentId: string, url: string, parent: DocumentRef | null) {
    if (!parent || !PAGE_MADE.test(url)) return;
    const document = session.tabs[tabId]?.frames[frameId]?.documents[documentId];
    if (document) document.madeBy = parent;
}

/**
 * Where what happens in a document is recorded: in the document itself, or for one the page made
 * (see notePageMade), in the nearest document above it with an address of its own, so a script
 * reading through frames it made is scored as a whole, not once per frame. Without a link, or with
 * one to a document no longer kept, a document is recorded as itself.
 */
export function recordingTarget(session: Session, tabId: number, frameId: number, documentId: string): DocumentRef {
    const frames = session.tabs[tabId]?.frames ?? {};
    let target: DocumentRef = { frameId, documentId };
    // Each link leads to a frame above, so at most as many steps as there are frames.
    for (let steps = Object.keys(frames).length; steps > 0; steps--) {
        const madeBy = frames[target.frameId]?.documents[target.documentId]?.madeBy;
        if (!madeBy || !frames[madeBy.frameId]?.documents[madeBy.documentId]) break;
        target = madeBy;
    }
    return target;
}

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
export function storeFpEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | null | undefined, event: FpMonkeyEvent, maxCalls = Infinity): boolean {
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
    // Without a position (e.g. a call from the console), it is counted, but not placed.
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
export function storeHttpEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | null | undefined, event: HttpMonkeyEvent) {
    const scriptUrls = event.scriptUrls.length > 0 ? event.scriptUrls : [event.scriptUrl];
    for (const scriptUrl of scriptUrls) {
        const { script } = ensureScript(session, tabId, frameId, documentId, url, scriptUrl);
        script.httpEvents.push(event);
    }
}

/** Notes a value the script stored, keeping the latest value of each cookie or item. */
export function storeStorageEvent(session: Session, tabId: number, frameId: number, documentId: string, url: string | null | undefined, event: StorageMonkeyEvent) {
    const { script } = ensureScript(session, tabId, frameId, documentId, url, event.scriptUrl);
    const item = (script.stored[`${event.kind}|${event.name}`] ??= { kind: event.kind, name: event.name, value: null, expires: null, writes: 0, first: event.timeStamp, last: event.timeStamp });
    item.value = event.value;
    item.expires = event.expires;
    item.writes += 1;
    item.first = Math.min(item.first, event.timeStamp);
    item.last = Math.max(item.last, event.timeStamp);
}
