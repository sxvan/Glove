import type { DnsResult, FpMetrics, FpSpike, HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';
import type { CallLocation } from './snapshot';

/** An API's calls by a script: how many, and from where in the code (by "line:column"). */
export interface ApiCalls {
    count: number;
    locations: Record<string, CallLocation>;
}

export interface ScriptState {
    /** Its raw calls, thinned out for long-lived documents (see thinning). */
    fpEvents: FpMonkeyEvent[];
    /** Its calls per API, counted as they arrive: exact also once fpEvents are thinned out. */
    calls: Record<string, ApiCalls>;
    /** How many calls it made, thinned-out ones included. */
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
