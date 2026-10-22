import type { HttpConsolidatedEvent } from '@/types/analysis';
import type { ScriptDetail } from './scripts';
import { hostOf, realSite, urlPath } from './urls';

/** A request with data, as the extension saw it: its contents are unknown, only its size. */
export interface SentRequest {
    /** Its whole address, for the tooltip. */
    url: string;
    method: string;
    /** How the script sent it; null if the page's recorder didn't see it, only the browser. */
    how: 'fetch' | 'xhr' | 'beacon' | 'image' | null;
    /** How long after the burst before it it was sent, in ms: 0 for during it; null if unknown, or not sent right after one. */
    afterMs: number | null;
    /** The names of its URL's parameters, in their order; the values aren't shown, only what they are called. */
    params: string[];
    /** The site the request really ends on (see realSite). */
    site: string;
    /** The host it went to if that is a CNAME alias for site, which it then went "through"; null otherwise. */
    via: string | null;
    path: string;
    /**
     * How much data it carried, in bytes: its body and its URL's query string, so a POST and a GET
     * are measured alike (a GET carries its data in the query).
     */
    bytes: number;
}

/**
 * All requests with data a script made (`requests`), one per URL: those it made right after
 * fingerprinting (`correlations`) with how long after.
 */
export function allRequests(requests: HttpConsolidatedEvent[], correlations: (HttpConsolidatedEvent & { burstEnd: number })[], aliases: Map<string, string>): SentRequest[] {
    // A request, by when it was made and where to: the snapshot copies requests, so not by identity.
    const id = ({ httpEvent, httpRequest }: HttpConsolidatedEvent) => `${httpEvent?.timeStamp}|${httpEvent?.requestUrl ?? httpRequest?.url}`;
    const burstEnds = new Map(correlations.map((correlation) => [id(correlation), correlation.burstEnd]));
    return sentRequests(requests.map((request) => ({ ...request, burstEnd: burstEnds.get(id(request)) })), aliases);
}

/** The requests with data a script made right after fingerprinting, the most data first; one per URL. */
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
        // Of the same URL sent more than once: the one right after reading, which the score counts,
        // then the one with the most data.
        const key = `${method} ${url}`;
        const known = byUrl.get(key);
        if (!known || (known.afterMs === null && request.afterMs !== null) || ((known.afterMs === null) === (request.afterMs === null) && known.bytes < request.bytes)) byUrl.set(key, request);
    }
    return [...byUrl.values()].sort((a, b) => b.bytes - a.bytes);
}

/**
 * What the page's scripts sent right after reading, once per request: one request counts for every
 * script on its stack (see storeHttpEvent), so several can have the same. The most data first.
 */
export function pageSent(scripts: ScriptDetail[]): SentRequest[] {
    const byRequest = new Map<string, SentRequest>();
    for (const script of scripts) {
        for (const request of script.sent) byRequest.set(`${request.method} ${request.url}`, request);
    }
    return [...byRequest.values()].sort((a, b) => b.bytes - a.bytes);
}
