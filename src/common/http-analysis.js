import { getEtld1, getHostname, isCrossOrigin } from './http-utils.js';

/**
 * @param {HttpRequest} httpRequest
 */
function isCnameCloaked(httpRequest) {
    return httpRequest.isCrossHost && httpRequest.looksFirstParty && httpRequest.endsThirdParty && httpRequest.cNameDepth > 0;
}

export function getEnrichedHttpRequestsWithDns(document, dnsResults) {
    const enrichedHttpRequests = [];
    for (const httpRequest of document.httpRequests) {
        let enrichedHttpRequest = httpRequest;
        const dnsEntry = dnsResults.get(enrichedHttpRequest.hostname);
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

/**
 * @param {HttpMonkeyEvent[]} httpEvents
 * @param {HttpRequest[]} httpRequests
 * @returns {HttpConsolidatedEvent[]}
 */
export function consolidateHttpEvents(httpEvents, httpRequests, maxDeltaMs = 1000) {
    const correlations = [];
    const used = new Set();

    for (const httpEvent of httpEvents) {
        let bestIndex = -1;
        let bestDelta = maxDeltaMs + 1;

        for (let i = 0; i < httpRequests.length; i++) {
            if (used.has(i)) continue;

            const req = httpRequests[i];

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
                httpRequest: httpRequests[bestIndex],
                timeDeltaMs: bestDelta,
            });
        } else {
            // console.warn('No match found for HTTP event', httpEvent);
        }
    }

    return correlations;
}
