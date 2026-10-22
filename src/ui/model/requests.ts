import type { HttpConsolidatedEvent } from '@/types/analysis';
import type { ScriptDetail } from './scripts';
import { hostOf, realSite, urlPath } from './urls';

/** Its contents are unknown to the extension, only its size. */
export interface SentRequest {
    url: string;
    method: string;
    /** Null if the page's recorder didn't see it, only the browser. */
    how: 'fetch' | 'xhr' | 'beacon' | 'image' | null;
    /** After the burst before it: 0 for during it; null if not sent right after one. */
    afterMs: number | null;
    /** Only the names: the values aren't shown. */
    params: string[];
    site: string;
    /** The host it went to if that is a CNAME alias for site. */
    via: string | null;
    path: string;
    /** Its body and its query string, so a POST and a GET are measured alike. */
    bytes: number;
}

export function allRequests(requests: HttpConsolidatedEvent[], correlations: (HttpConsolidatedEvent & { burstEnd: number })[], aliases: Map<string, string>): SentRequest[] {
    // Not by identity: the snapshot copies requests.
    const id = ({ httpEvent, httpRequest }: HttpConsolidatedEvent) => `${httpEvent?.timeStamp}|${httpEvent?.requestUrl ?? httpRequest?.url}`;
    const burstEnds = new Map(correlations.map((correlation) => [id(correlation), correlation.burstEnd]));
    return sentRequests(requests.map((request) => ({ ...request, burstEnd: burstEnds.get(id(request)) })), aliases);
}

export function sentRequests(correlations: (HttpConsolidatedEvent & { burstEnd?: number })[], aliases: Map<string, string>): SentRequest[] {
    const byUrl = new Map<string, SentRequest>();
    for (const { httpRequest, httpEvent, burstEnd } of correlations) {
        const url = httpRequest?.url ?? httpEvent?.requestUrl;
        if (!url) continue;
        const method = (httpRequest?.method ?? httpEvent?.method ?? 'GET').toUpperCase();
        let query = '';
        let params: string[] = [];
        try {
            const parsed = new URL(url);
            query = parsed.search.slice(1);
            params = [...new Set(parsed.searchParams.keys())];
        } catch {}
        const request: SentRequest = {
            url,
            method,
            how: httpEvent?.id ?? null,
            afterMs: httpEvent && burstEnd !== undefined ? Math.max(0, httpEvent.timeStamp - burstEnd) : null,
            params,
            site: realSite(hostOf(url), aliases) ?? hostOf(url),
            via: aliases.has(hostOf(url)) ? hostOf(url) : null,
            path: urlPath(url),
            bytes: (httpRequest?.bodyBytes ?? 0) + new TextEncoder().encode(query).length,
        };
        // Of the same URL sent more than once: the one right after reading, which the score counts.
        const key = `${method} ${url}`;
        const known = byUrl.get(key);
        if (!known || (known.afterMs === null && request.afterMs !== null) || ((known.afterMs === null) === (request.afterMs === null) && known.bytes < request.bytes)) byUrl.set(key, request);
    }
    return [...byUrl.values()].sort((a, b) => b.bytes - a.bytes);
}

// A request counts for every script on its stack (see storeHttpEvent): here it is once.
export function pageSent(scripts: ScriptDetail[]): SentRequest[] {
    const byRequest = new Map<string, SentRequest>();
    for (const script of scripts) {
        for (const request of script.sent) byRequest.set(`${request.method} ${request.url}`, request);
    }
    return [...byRequest.values()].sort((a, b) => b.bytes - a.bytes);
}
