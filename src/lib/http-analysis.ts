import type { DnsResult, HttpConsolidatedEvent, HttpRequest } from '@/types/analysis';
import type { HttpMonkeyEvent } from '@/types/events';
import type { DocumentState } from '@/types/session';
import { getEtld1, getHostname, isCrossOrigin } from './http-utils';

function isCnameCloaked(httpRequest: HttpRequest): boolean {
    return !!(httpRequest.isCrossHost && httpRequest.looksFirstParty && httpRequest.endsThirdParty && httpRequest.cNameDepth! > 0);
}

/**
 * Adds DNS-based fields to the document's requests whose lookup has finished. Requests still
 * waiting for (or without) a DNS result are kept unchanged and enriched by a later analysis; those
 * already enriched are skipped, as their DNS result doesn't change.
 */
export function enrichHttpRequestsWithDns(document: DocumentState, dnsResults: Map<string, DnsResult>) {
    for (const httpRequest of document.httpRequests) {
        const enrichedHttpRequest = httpRequest;
        if (enrichedHttpRequest.cNameDepth !== undefined) continue;
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

const withoutFragment = (url: string) => url.split('#')[0]!;

/** The document's requests by URL without fragment, as indexes into httpRequests in time order. */
interface RequestIndex {
    byUrl: Map<string, number[]>;
    /** The array indexed: a new one is indexed anew. */
    requests: HttpRequest[];
    /** How many of the document's requests it holds; newer ones are added on the next use. */
    count: number;
}

const requestIndexes = new WeakMap<DocumentState, RequestIndex>();

/**
 * The index of the document's requests by URL, kept between analyses and extended with the
 * requests added since: requests are only ever appended.
 */
export function requestIndexOf(document: DocumentState): RequestIndex {
    let index = requestIndexes.get(document);
    if (!index || index.requests !== document.httpRequests) {
        index = { byUrl: new Map(), requests: document.httpRequests, count: 0 };
        requestIndexes.set(document, index);
    }
    const requests = document.httpRequests;
    for (; index.count < requests.length; index.count++) {
        const url = withoutFragment(requests[index.count]!.url);
        const list = index.byUrl.get(url);
        if (list) list.push(index.count);
        else index.byUrl.set(url, [index.count]);
    }
    return index;
}

/**
 * Matches the requests scripts made (as recorded in the page) to the requests the browser saw, by
 * exact URL (the recorder resolves them; fragments aren't sent) and method, the closest in time.
 * `index` looks the requests up by URL (see requestIndexOf), so a match costs only the requests
 * to the same URL rather than all of them.
 */
export function consolidateHttpEvents(httpEvents: HttpMonkeyEvent[], httpRequests: HttpRequest[], index: RequestIndex, maxDeltaMs = 1000): HttpConsolidatedEvent[] {
    const correlations: HttpConsolidatedEvent[] = [];
    const used = new Set<number>();

    for (const httpEvent of httpEvents) {
        // An XHR sent before open() has no URL and cannot be matched.
        if (!httpEvent.requestUrl) continue;
        const eventUrl = withoutFragment(httpEvent.requestUrl);

        let bestIndex = -1;
        let bestDelta = maxDeltaMs + 1;

        for (const i of index.byUrl.get(eventUrl) ?? []) {
            if (used.has(i)) continue;

            const req = httpRequests[i]!;

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
export function carriesData(consolidated: HttpConsolidatedEvent): boolean {
    const known = carriesDataOf.get(consolidated.httpEvent);
    if (known && known.request === consolidated.httpRequest) return known.value;
    const value = computeCarriesData(consolidated);
    carriesDataOf.set(consolidated.httpEvent, { request: consolidated.httpRequest, value });
    return value;
}

// Whether a recorded request carries data, worked out once per request it's matched to.
const carriesDataOf = new WeakMap<HttpMonkeyEvent, { request: HttpRequest; value: boolean }>();

function computeCarriesData({ httpEvent, httpRequest }: HttpConsolidatedEvent): boolean {
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
