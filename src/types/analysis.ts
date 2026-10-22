import type { Browser } from 'wxt/browser';
import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';
import type { SignalPart } from '@/lib/scoring';

/** One answer record of a DNS response (see dns-lookup). */
export interface DnsAnswer {
    name: string;
    type: number;
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
    isCnameCloaked?: boolean;
    cRecords?: CnameRecord[];
    cNameDepth?: number;
}

export interface FpMetrics {
    distinctFpApis: Set<string>;
    intensity: number;
    durationMs: number;
    score?: number;
    /** The signals the score was combined from, by signal key (see scoring). */
    signals?: Record<string, SignalPart>;
}

export interface HttpConsolidatedEvent {
    httpEvent: HttpMonkeyEvent;
    httpRequest: HttpRequest;
}

export interface FpSpike {
    events: FpMonkeyEvent[];
    fpMetrics?: FpMetrics | null;
    httpCorrelations?: HttpConsolidatedEvent[];
}
