import type { DnsResult, FpMetrics, FpSpike, HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';

export interface ScriptState {
    fpEvents: FpMonkeyEvent[];
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
