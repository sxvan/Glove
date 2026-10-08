import type { DnsResult, HttpConsolidatedEvent, HttpRequest } from '@/types/analysis';
import type { HttpMonkeyEvent } from '@/types/events';
import type { DocumentState } from '@/types/session';
import { getEtld1, getHostname, isCrossOrigin } from './http-utils';

function isCnameCloaked(httpRequest: HttpRequest): boolean {
    return !!(httpRequest.isCrossHost && httpRequest.looksFirstParty && httpRequest.endsThirdParty && httpRequest.cNameDepth! > 0);
}

export function getEnrichedHttpRequestsWithDns(document: DocumentState, dnsResults: Map<string, DnsResult>): HttpRequest[] {
    const enrichedHttpRequests: HttpRequest[] = [];
    for (const httpRequest of document.httpRequests) {
        let enrichedHttpRequest = httpRequest;
        const dnsEntry = enrichedHttpRequest.hostname ? dnsResults.get(enrichedHttpRequest.hostname) : undefined;
        if (!dnsEntry) {
            continue;
        }

        const documentHost = getHostname(enrichedHttpRequest.documentUrl);

        const documentHostEtld1 = getEtld1(documentHost);
        const requestHostEtld1 = getEtld1(enrichedHttpRequest.hostname);

        enrichedHttpRequest.looksFirstParty = documentHostEtld1 === requestHostEtld1;
        enrichedHttpRequest.endsThirdParty = documentHostEtld1 !== dnsEntry.finalEtld1;

        enrichedHttpRequest.isCrossOrigin = isCrossOrigin(enrichedHttpRequest.documentUrl, enrichedHttpRequest.url);
        enrichedHttpRequest.cNameDepth = dnsEntry.cNameDepth;
        enrichedHttpRequest.cRecords = dnsEntry.cRecords;
        enrichedHttpRequest.isCrossHost = documentHost !== enrichedHttpRequest.hostname;

        enrichedHttpRequest.isCnameCloaked = isCnameCloaked(enrichedHttpRequest);

        enrichedHttpRequests.push(enrichedHttpRequest);
    }

    return enrichedHttpRequests;
}

export function consolidateHttpEvents(httpEvents: HttpMonkeyEvent[], httpRequests: HttpRequest[], maxDeltaMs = 1000): HttpConsolidatedEvent[] {
    const correlations: HttpConsolidatedEvent[] = [];
    const used = new Set<number>();

    for (const httpEvent of httpEvents) {
        // An XHR sent before open() has no URL and cannot be matched.
        if (!httpEvent.requestUrl) continue;

        let bestIndex = -1;
        let bestDelta = maxDeltaMs + 1;

        for (let i = 0; i < httpRequests.length; i++) {
            if (used.has(i)) continue;

            const req = httpRequests[i]!;

            if (!req.url.toLowerCase().includes(httpEvent.requestUrl.toLowerCase())) continue;

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
