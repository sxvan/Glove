import type { DnsResult, FpMetrics, FpSpike, HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';
import type { CallLocation } from './snapshot';

/** An API's calls by a script: how many, and from where in the code (by "line:column"). */
export interface ApiCalls {
    count: number;
    /** When it was first and last called (ms since the epoch). */
    first: number;
    last: number;
    locations: Record<string, CallLocation>;
}

export interface ScriptState {
    /** Its raw calls. */
    fpEvents: FpMonkeyEvent[];
    /** Its calls per API, counted as they arrive. */
    calls: Record<string, ApiCalls>;
    /** How many calls it made, counted as they arrive. */
    callCount: number;
    httpEvents: HttpMonkeyEvent[];
    httpConsolidatedEvents: HttpConsolidatedEvent[];
    fpSpikes: FpSpike[];
    fpMetrics?: FpMetrics | null;
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
