import type { DnsResult, HttpConsolidatedEvent, HttpRequest } from '@/types/analysis';
import type { RequestEvent } from '@/types/events';
import type { DocumentState } from '@/types/session';
import { getEtld1, getHostname } from './http-utils';

export function enrichHttpRequestsWithDns(document: DocumentState, dnsResults: Map<string, DnsResult>) {
    for (const request of document.httpRequests) {
        if (request.cNameDepth !== undefined) continue;
        const dnsEntry = request.hostname ? dnsResults.get(request.hostname) : undefined;
        if (!dnsEntry) continue;

        // Judged against the tab's page: a host of an ad frame's own domain isn't hiding behind the site visited.
        const pageHost = getHostname(request.pageUrl);
        const pageSite = getEtld1(pageHost);
        request.cNameDepth = dnsEntry.cNameDepth;
        request.cRecords = dnsEntry.cRecords;
        request.isCnameCloaked = pageHost !== request.hostname && getEtld1(request.hostname) === pageSite && dnsEntry.finalEtld1 !== pageSite && dnsEntry.cNameDepth > 0;
    }
}

const withoutFragment = (url: string) => url.split('#')[0]!;

interface RequestIndex {
    byUrl: Map<string, number[]>;
    requests: HttpRequest[];
    count: number;
}

const requestIndexes = new WeakMap<DocumentState, RequestIndex>();

// Kept between analyses and extended: requests are only ever appended.
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

// By exact URL (the recorder resolves them; fragments aren't sent) and method, the closest in time.
export function consolidateHttpEvents(httpEvents: RequestEvent[], httpRequests: HttpRequest[], index: RequestIndex, maxDeltaMs = 1000): HttpConsolidatedEvent[] {
    const correlations: HttpConsolidatedEvent[] = [];
    const used = new Set<number>();

    for (const httpEvent of httpEvents) {
        // One whose address couldn't be resolved has nothing to match.
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
            correlations.push({ httpEvent, httpRequest: httpRequests[bestIndex]! });
        }
    }

    return correlations;
}

// Downloads of files rather than data being sent, even with a query (e.g. "showads.js?adspot=1").
const STATIC_FILE = /\.(?:m?js|css|json|map|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3)$/i;

// Image pixels with a file name still count with this many query parameters (e.g. "pixel.gif?a=…&b=…&c=…").
const PIXEL_MIN_PARAMETERS = 3;

// Images loaded by scripts often carry a query too (lazy loading, sizes), so a file name like ".jpg"
// only counts as a pixel with several parameters.
export function carriesData(consolidated: HttpConsolidatedEvent): boolean {
    const known = carriesDataOf.get(consolidated.httpEvent);
    if (known && known.request === consolidated.httpRequest) return known.value;
    const value = computeCarriesData(consolidated);
    carriesDataOf.set(consolidated.httpEvent, { request: consolidated.httpRequest, value });
    return value;
}

// Whether a recorded request carries data, worked out once per request it's matched to.
const carriesDataOf = new WeakMap<RequestEvent, { request: HttpRequest; value: boolean }>();

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
