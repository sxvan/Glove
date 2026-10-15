import type { HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { FpMonkeyEvent, GeneratedPosition } from './events';

// Snapshots are the serializable views of the session state sent to the popup.

export interface MetricsSnapshot {
    distinctFpApis: string[];
    distinctFpCategories: string[];
    intensity: number;
    durationMs: number;
    density: number;
    startTime: number;
    endTime: number;
    score?: number;
}

export interface SpikeSnapshot {
    events: FpMonkeyEvent[];
    fpMetrics: MetricsSnapshot | null;
    httpCorrelations?: HttpConsolidatedEvent[];
}

export interface ScriptSnapshot {
    name: string;
    fpMetrics: MetricsSnapshot | null;
    fpSpikes: (SpikeSnapshot | null)[];
    /** Number of calls per fingerprinting API id. */
    apiCounts: Record<string, number>;
    /** Distinct positions in the script each API was called from, most calls first. */
    apiLocations: Record<string, CallLocation[]>;
}

/** A position in a script's source (1-based, as in stack traces) and how often an API was called there. */
export interface CallLocation {
    line: number;
    column: number;
    /** For calls from code generated at runtime: that code and the position in it (see FpMonkeyEvent). */
    generated: GeneratedPosition | null;
    calls: number;
}

export interface DocumentSnapshot {
    documentId: string;
    url: string | null;
    fpMetrics: MetricsSnapshot | null;
    scripts: ScriptSnapshot[];
}

export interface FrameSnapshot {
    frameId: string;
    document: DocumentSnapshot;
}

export interface TabSnapshot {
    cNameRequests: HttpRequest[];
    dnsTrackingRequests: HttpRequest[];
    frames: (FrameSnapshot | null)[];
}
