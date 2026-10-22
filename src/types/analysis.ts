import type { Browser } from 'wxt/browser';
import type { ApiCallEvent, RequestEvent } from './events';
import type { SignalPart } from '@/lib/scoring';

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

export interface HttpRequest extends Browser.webRequest.OnBeforeRequestDetails {
    hostname: string | null;
    documentUrl: string | null;
    /** The tab's page when the request was made: cloaking is judged against it, not an ad frame's own domain. */
    pageUrl: string | null;
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
    signals?: Record<string, SignalPart>;
}

export interface HttpConsolidatedEvent {
    httpEvent: RequestEvent;
    httpRequest: HttpRequest;
}

export interface FpBurst {
    events: ApiCallEvent[];
    fpMetrics?: FpMetrics | null;
    httpCorrelations?: HttpConsolidatedEvent[];
}
