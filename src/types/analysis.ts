import type { Browser } from 'wxt/browser';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';
import type { SignalPart } from '@/lib/scoring';

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
    /**
     * The URL of the tab's page (its top frame) when the request was made; the same as documentUrl
     * for the page's own requests. CNAME cloaking is judged against it: hiding behind the name of
     * the site the user visits, not an ad frame's own domain.
     */
    pageUrl: string | null;
    /** The size of the request's body in bytes; 0 without one. */
    bodyBytes: number;
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
    /** The signals the score was combined from, by signal key (see scoring). */
    signals?: Record<string, SignalPart>;
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
