import type { DnsResult, HttpConsolidatedEvent, HttpRequest } from '@/types/analysis';
import type { HttpMonkeyEvent } from '@/types/events';
import type { DocumentState } from '@/types/session';
import { getEtld1, getHostname, isCrossOrigin } from './http-utils';

function isCnameCloaked(httpRequest: HttpRequest): boolean {
    return !!(httpRequest.isCrossHost && httpRequest.looksFirstParty && httpRequest.endsThirdParty && httpRequest.cNameDepth! > 0);
}

/**
 * Adds DNS-based fields to the document's requests whose lookup has finished. Requests still
 * waiting for (or without) a DNS result are kept unchanged and enriched by a later analysis.
 */
export function enrichHttpRequestsWithDns(document: DocumentState, dnsResults: Map<string, DnsResult>) {
    for (const httpRequest of document.httpRequests) {
        const enrichedHttpRequest = httpRequest;
        const dnsEntry = enrichedHttpRequest.hostname ? dnsResults.get(enrichedHttpRequest.hostname) : undefined;
        if (!dnsEntry) {
            continue;
        }

        // Cloaking is judged against the tab's page: a host of an ad frame's own domain isn't hiding
        // behind the site the user visits. Older requests without pageUrl use their document.
        const pageHost = getHostname(enrichedHttpRequest.pageUrl ?? enrichedHttpRequest.documentUrl);

        const pageHostEtld1 = getEtld1(pageHost);
        const requestHostEtld1 = getEtld1(enrichedHttpRequest.hostname);

        enrichedHttpRequest.looksFirstParty = pageHostEtld1 === requestHostEtld1;
        enrichedHttpRequest.endsThirdParty = pageHostEtld1 !== dnsEntry.finalEtld1;

        enrichedHttpRequest.isCrossOrigin = isCrossOrigin(enrichedHttpRequest.documentUrl, enrichedHttpRequest.url);
        enrichedHttpRequest.cNameDepth = dnsEntry.cNameDepth;
        enrichedHttpRequest.cRecords = dnsEntry.cRecords;
        enrichedHttpRequest.isCrossHost = pageHost !== enrichedHttpRequest.hostname;

        enrichedHttpRequest.isCnameCloaked = isCnameCloaked(enrichedHttpRequest);
    }
}

/**
 * Matches the requests scripts made (as recorded in the page) to the requests the browser saw, by
 * exact URL (the recorder resolves them; fragments aren't sent) and method, the closest in time.
 */
export function consolidateHttpEvents(httpEvents: HttpMonkeyEvent[], httpRequests: HttpRequest[], maxDeltaMs = 1000): HttpConsolidatedEvent[] {
    const correlations: HttpConsolidatedEvent[] = [];
    const used = new Set<number>();
    const withoutFragment = (url: string) => url.split('#')[0];

    for (const httpEvent of httpEvents) {
        // An XHR sent before open() has no URL and cannot be matched.
        if (!httpEvent.requestUrl) continue;
        const eventUrl = withoutFragment(httpEvent.requestUrl);

        let bestIndex = -1;
        let bestDelta = maxDeltaMs + 1;

        for (let i = 0; i < httpRequests.length; i++) {
            if (used.has(i)) continue;

            const req = httpRequests[i]!;

            if (withoutFragment(req.url) !== eventUrl) continue;

            if (req.method && httpEvent.method && req.method !== httpEvent.method) continue;

            const dt = Math.abs(req.timeStamp - httpEvent.timeStamp);

            if (dt > maxDeltaMs) continue;

            if (dt < bestDelta) {
                bestDelta = dt;
                bestIndex = i;
            }
        }

        if (bestIndex !== -1) {
            used.add(bestIndex);
            correlations.push({
                httpEvent,
                httpRequest: httpRequests[bestIndex]!,
                timeDeltaMs: bestDelta,
            });
        } else {
            // console.warn('No match found for HTTP event', httpEvent);
        }
    }

    return correlations;
}

// Downloads of files rather than data being sent, even with a query (e.g. "showads.js?adspot=1").
const STATIC_FILE = /\.(?:m?js|css|json|map|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3)$/i;

// Image pixels with a file name still count with this many query parameters (e.g. "pixel.gif?a=…&b=…&c=…").
const PIXEL_MIN_PARAMETERS = 3;

/**
 * True for requests that send something: a body (POST and the like), or a query on anything but a
 * static file. Images loaded by scripts often carry a query too (lazy loading, image sizes), so a
 * file name like ".jpg" only counts as a pixel with several parameters.
 */
export function carriesData({ httpEvent, httpRequest }: HttpConsolidatedEvent): boolean {
    const method = (httpEvent.method ?? httpRequest.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return true;

    let url: URL;
    try {
        url = new URL(httpRequest.url);
    } catch {
        return false;
    }
    if (!url.search) return false;
    if (!STATIC_FILE.test(url.pathname)) return true;
    return httpEvent.id === 'image' && url.searchParams.size >= PIXEL_MIN_PARAMETERS;
}
