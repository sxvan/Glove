import type { DnsResult, FpMetrics, FpBurst, HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { ApiCallEvent, RequestEvent } from './events';
import type { CallLocation, StoredItem } from './snapshot';

export interface ApiCalls {
    count: number;
    /** When it was first and last called (ms since the epoch). */
    first: number;
    last: number;
    locations: Record<string, CallLocation>;
}

export interface ScriptState {
    fpEvents: ApiCallEvent[];
    calls: Record<string, ApiCalls>;
    /** Up to the limit (see lib/limits). */
    callCount: number;
    capped?: boolean;
    httpEvents: RequestEvent[];
    httpConsolidatedEvents: HttpConsolidatedEvent[];
    bursts: FpBurst[];
    fpMetrics?: FpMetrics | null;
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
    bursts: FpBurst[];
    fpMetrics?: FpMetrics | null;
    /** By blockKey. */
    blockedScripts: Record<string, BlockedAttempt>;
    /** For a document the page made itself: the one that made it, where it is recorded (see recordingTarget). */
    madeBy?: DocumentRef;
}

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
