import type { IdentifierRules } from '@/lib/identifiers';
import type { HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { ScoringSettings, SignalPart } from '@/lib/scoring';
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
    /** The signals the score was combined from, by signal key (see scoring). */
    signals?: Record<string, SignalPart>;
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
    /** When each API was first and last called (ms since the epoch); missing from an older background. */
    apiTimes?: Record<string, { first: number; last: number }>;
    /** What it stored in the browser, in the order first stored; missing from an older background. */
    stored?: StoredItem[];
    /** Whether it reached the limit of calls kept per script (see lib/limits). */
    capped?: boolean;
}

export type StorageKind = 'cookie' | 'localStorage' | 'sessionStorage' | 'indexedDB';

/** A cookie or storage item a script wrote, with its latest value. */
export interface StoredItem {
    kind: StorageKind;
    name: string;
    /** The latest value written, cut to a length; null for IndexedDB records. */
    value: string | null;
    /** When a cookie expires (ms since the epoch), as last written; null until the browser closes, or for other storage. */
    expires: number | null;
    writes: number;
    /** When it was first and last written (ms since the epoch). */
    first: number;
    last: number;
}

/** A position in a script's source (1-based, as in stack traces) and how often an API was called there. */
export interface CallLocation {
    line: number;
    column: number;
    /** True when the calls came from code generated at runtime, here being where it was generated. */
    generated: boolean;
    /** For generated code, the position of the calls inside it, which tells its places apart (see placeKey). */
    inner?: { line: number; column: number };
    calls: number;
}

export interface DocumentSnapshot {
    documentId: string;
    url: string | null;
    /** When the document started (ms since the epoch), for times relative to it; missing from an older background. */
    startTime?: number;
    fpMetrics: MetricsSnapshot | null;
    /** The page's own bursts, across all its scripts; without their calls, which the scripts have. */
    spikes: MetricsSnapshot[];
    scripts: ScriptSnapshot[];
    /** Blocked scripts that tried to load (see lib/blocking); missing from an older background. */
    blockedScripts?: { url: string; attempts: number }[];
}

export interface FrameSnapshot {
    frameId: string;
    document: DocumentSnapshot;
}

export interface TabSnapshot {
    cNameRequests: HttpRequest[];
    dnsTrackingRequests: HttpRequest[];
    frames: (FrameSnapshot | null)[];
    /** Where scores count as possible or likely, from the user's scoring settings. */
    cutoffs: ScoringSettings['cutoffs'];
    /** Each API's bits and rarity the scores were made with, from the user's scoring settings. */
    apis?: ScoringSettings['apis'];
    /** The exponent rarity counts with (see ScoringSettings.rarityPower); missing from an older background. */
    rarityPower?: number;
    /** Whether the page reached the limit of calls kept per page (see lib/limits). */
    callsCapped?: boolean;
    /** What counts as a possible identifier among stored values, and how long after a burst counts as right after it; missing from an older background. */
    identifiers?: IdentifierRules;
    rightAfterMs?: number;
}
