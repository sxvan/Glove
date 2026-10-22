import type { IdentifierRules } from '@/lib/identifiers';
import type { HttpConsolidatedEvent, HttpRequest } from './analysis';
import type { ScoringSettings, SignalPart } from '@/lib/scoring';
import type { ApiCallEvent, RequestEvent } from './events';


export interface MetricsSnapshot {
    distinctFpApis: string[];
    intensity: number;
    durationMs: number;
    score?: number;
    signals?: Record<string, SignalPart>;
}

export interface BurstSnapshot {
    events: ApiCallEvent[];
    fpMetrics: MetricsSnapshot | null;
    httpCorrelations?: HttpConsolidatedEvent[];
}

export interface ScriptSnapshot {
    name: string;
    fpMetrics: MetricsSnapshot | null;
    bursts: BurstSnapshot[];
    apiCounts: Record<string, number>;
    /** Distinct positions in the script each API was called from, most calls first. */
    apiLocations: Record<string, CallLocation[]>;
    /** When each API was first and last called (ms since the epoch). */
    apiTimes: Record<string, { first: number; last: number }>;
    /** In the order first stored. */
    stored: StoredItem[];
    /** Its requests carrying data, at any time (see carriesData). */
    requests: HttpConsolidatedEvent[];
    /** The CNAME-cloaked hosts of the site it sent data to, at any time (see isCnameCloaked). */
    cloakedHosts: string[];
    capped?: boolean;
}

export type StorageKind = 'cookie' | 'localStorage' | 'sessionStorage' | 'indexedDB';

/** Asked for apart from the snapshot, as a page has up to tens of thousands of events. */
export interface EventLog {
    /** When the tab's page started (ms since the epoch); null without one. */
    startTime: number | null;
    entries: EventLogEntry[];
}

/** One recorded event: who made it (a script's URL, as in its snapshot, in a frame), and when (ms since the epoch). */
export type EventLogEntry = { frameId: string; script: string; time: number } & (
    | {
          kind: 'api';
          api: string;
          /** Where in the script it was called (1-based); for generated code, where the script generated it. */
          line: number | null;
          column: number | null;
          generated: boolean;
          /** Which of the script's bursts of calls it was in, counted from 1 in time order; null outside them. */
          burst: number | null;
      }
    | { kind: 'request'; how: RequestEvent['id']; method: string | null; url: string | null }
    /** A stored value at its first write: single writes aren't kept, only how many there were. */
    | { kind: 'stored'; storage: StorageKind; name: string; writes: number }
);

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
    /** When the document started (ms since the epoch), for times relative to it. */
    startTime: number;
    fpMetrics: MetricsSnapshot | null;
    /** The page's own bursts, across all its scripts; without their calls, which the scripts have. */
    bursts: MetricsSnapshot[];
    scripts: ScriptSnapshot[];
    blockedScripts: { url: string; attempts: number }[];
}

export interface FrameSnapshot {
    frameId: string;
    document: DocumentSnapshot;
}

export interface TabSnapshot {
    cNameRequests: HttpRequest[];
    frames: (FrameSnapshot | null)[];
    cutoffs: ScoringSettings['cutoffs'];
    apis: ScoringSettings['apis'];
    rarityPower: number;
    callsCapped: boolean;
    identifiers: IdentifierRules;
    rightAfterMs: number;
}
