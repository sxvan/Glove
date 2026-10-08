import type { Browser } from 'wxt/browser';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';

/** One entry of the `Answer` array returned by DNS-over-HTTPS JSON APIs. */
export interface DnsAnswer {
    name: string;
    type: number;
    TTL: number;
    data: string;
}

export interface CnameRecord {
    source: string;
    target: string;
}

export interface DnsResult {
    hostname: string;
    cRecords: CnameRecord[];
    cNameDepth: number;
    eTld1: string | null;
    finalEtld1: string | null;
}

/** A webRequest event, enriched with document and DNS information during analysis. */
export interface HttpRequest extends Browser.webRequest.OnBeforeRequestDetails {
    hostname: string | null;
    documentUrl: string | null;
    looksFirstParty?: boolean;
    endsThirdParty?: boolean;
    isCnameCloaked?: boolean;
    isCrossOrigin?: boolean;
    isCrossHost?: boolean;
    cRecords?: CnameRecord[];
    cNameDepth?: number;
    subdomainScore?: number;
}

export interface FpMetrics {
    distinctFpApis: Set<string>;
    distinctFpCategories: Set<string>;
    intensity: number;
    durationMs: number;
    density: number;
    startTime: number;
    endTime: number;
    score?: number;
}

export interface HttpConsolidatedEvent {
    httpEvent: HttpMonkeyEvent;
    httpRequest: HttpRequest;
    timeDeltaMs: number;
    suspicionScore?: number;
}

export interface FpSpike {
    events: FpMonkeyEvent[];
    fpMetrics?: FpMetrics | null;
    httpCorrelations?: HttpConsolidatedEvent[];
}
