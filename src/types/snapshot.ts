import type { HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { FpMonkeyEvent } from './events';

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
