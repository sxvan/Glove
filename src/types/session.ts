import type { DnsResult, FpMetrics, FpSpike, HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';
import type { CallLocation, StoredItem } from './snapshot';

/** An API's calls by a script: how many, and from where in the code (by "line:column"). */
export interface ApiCalls {
    count: number;
    /** When it was first and last called (ms since the epoch). */
    first: number;
    last: number;
    locations: Record<string, CallLocation>;
}

export interface ScriptState {
    fpEvents: FpMonkeyEvent[];
    /** Its calls per API, counted as they arrive. */
    calls: Record<string, ApiCalls>;
    /** How many calls it made, counted as they arrive, up to the limit (see lib/limits). */
    callCount: number;
    /** Set once it reached the limit of calls kept per script: further ones weren't kept. */
    capped?: boolean;
    httpEvents: HttpMonkeyEvent[];
    httpConsolidatedEvents: HttpConsolidatedEvent[];
    fpSpikes: FpSpike[];
    fpMetrics?: FpMetrics | null;
    /** What it stored in the browser, by kind and name (see storeStorageEvent). */
    stored: Record<string, StoredItem>;
}

export interface DocumentState {
    documentId: string;
    currentUrl: string | null;
    startTime: number;
    endTime: number | null;
    httpRequests: HttpRequest[];
    /** Keyed by the URL of the script that made the calls. */
    scripts: Record<string, ScriptState>;
    spikes: FpSpike[];
    fpMetrics?: FpMetrics | null;
    /** Blocked scripts that tried to load (see lib/blocking), by what they are blocked by. */
    blockedScripts: Record<string, BlockedAttempt>;
    /**
     * For a document the page made itself rather than loaded (see notePageMade): the document of the
     * frame above it, which made it. What happens in it is recorded there (see recordingTarget).
     */
    madeBy?: DocumentRef;
}

/** A document of a tab, by its frame and its id. */
export interface DocumentRef {
    frameId: number;
    documentId: string;
}

export interface BlockedAttempt {
    /** The address it tried to load from, the first time. */
    url: string;
    attempts: number;
}

export interface FrameState {
    currentDocumentId: string | null;
    documents: Record<string, DocumentState>;
}

export interface TabState {
    frames: Record<number, FrameState>;
}

export interface Session {
    dnsResults: Map<string, DnsResult>;
    tabs: Record<number, TabState>;
}
