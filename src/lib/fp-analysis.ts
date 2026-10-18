import type { DnsResult, FpMetrics, FpSpike, HttpConsolidatedEvent } from '@/types/analysis';
import type { FpMonkeyEvent } from '@/types/events';
import type { DocumentState, ScriptState } from '@/types/session';
import { FP_APIS_BY_ID } from './fp-apis';
import { carriesData, consolidateHttpEvents, enrichHttpRequestsWithDns, requestIndexOf } from './http-analysis';
import { LIMITS, apisSums, combine, combineParts, saturate, type ApisLevel, type ApisSum, type ScoredParts, type ScoringSettings } from './scoring';
import { detectSpikes } from './spike-detection';
import { thinDocument } from './thinning';

/**
 * How much an API adds to a burst's API signals, to find the window reading the most (see
 * detectSpikes): its entropy and its rarity to rarityPower, each relative to where its signal is
 * full and weighed by the signal's strength. Close to the burst's score, and cheap to add up.
 */
function burstWeight(level: 'burst' | 'pageBurst', settings: ScoringSettings): (apiId: string) => number {
    const { identifying, unusualApis } = settings.strengths.burst;
    const fullAt = settings.fullAt[level];
    return (id) => {
        const traits = settings.apis[id];
        if (!traits) return 0;
        const information = fullAt.identifying > 0 ? (identifying * traits.entropy) / fullAt.identifying : 0;
        const unusual = fullAt.unusual > 0 ? (unusualApis * traits.rarity ** Math.max(0, settings.rarityPower)) / fullAt.unusual : 0;
        return information + unusual;
    };
}

/** Scores the document's scripts, their bursts of calls and the requests right after (see scoring). */
export function analyzeDocumentFp(document: DocumentState, dnsResults: Map<string, DnsResult>, settings: ScoringSettings) {
    const documentFpEvents: FpMonkeyEvent[] = [];
    const documentConsolidatedHttpEvents: HttpConsolidatedEvent[] = [];

    enrichHttpRequestsWithDns(document, dnsResults);
    const requestIndex = requestIndexOf(document);

    for (const [url, script] of Object.entries(document.scripts)) {
        if (script.fpEvents.length === 0) {
            continue;
        }

        documentFpEvents.push(...script.fpEvents);

        script.httpConsolidatedEvents = consolidateHttpEvents(script.httpEvents, document.httpRequests, requestIndex);

        for (const consolidatedHttp of script.httpConsolidatedEvents) {
            consolidatedHttp.suspicionScore = httpFpScore(consolidatedHttp, settings);
        }

        documentConsolidatedHttpEvents.push(...script.httpConsolidatedEvents);

        script.fpSpikes = detectSpikes(script.fpEvents, settings.bursts, burstWeight('burst', settings));

        for (const spike of script.fpSpikes) {
            spike.httpCorrelations = getCorrelatedHttpCandidates(spike, script.httpConsolidatedEvents, settings.bursts.requestWindowMs);
            spike.fpMetrics = getFpMetrics(spike.events);
            if (spike.fpMetrics) {
                setScore(spike.fpMetrics, computeSpikeFpScore(spike, spike.fpMetrics, settings));
            }
        }

        script.fpMetrics = getFpMetrics(script.fpEvents);
        if (script.fpMetrics) {
            // Thinned-out calls count too (see thinning).
            script.fpMetrics.intensity = Math.max(script.fpMetrics.intensity, script.callCount);
            setScore(script.fpMetrics, computeScriptFpScore(script, url, document, settings));
        }
    }

    document.spikes = detectSpikes(documentFpEvents, settings.bursts, burstWeight('pageBurst', settings));
    for (const spike of document.spikes) {
        spike.httpCorrelations = getCorrelatedHttpCandidates(spike, documentConsolidatedHttpEvents, settings.bursts.requestWindowMs);
        spike.fpMetrics = getFpMetrics(spike.events);
        if (spike.fpMetrics) {
            setScore(spike.fpMetrics, computeSpikeFpScore(spike, spike.fpMetrics, settings, 'pageBurst'));
        }
    }

    document.fpMetrics = getFpMetrics(documentFpEvents);
    if (document.fpMetrics) {
        document.fpMetrics.intensity = Math.max(
            document.fpMetrics.intensity,
            Object.values(document.scripts).reduce((sum, script) => sum + script.callCount, 0)
        );
        setScore(document.fpMetrics, computeDocumentFpScore(document, settings));
    }

    // Long-lived documents keep only what the analysis still needs (see thinning).
    thinDocument(document, settings.bursts.requestWindowMs);
}

function setScore(metrics: FpMetrics, scored: ScoredParts) {
    metrics.score = scored.score;
    metrics.signals = scored.parts;
}

function getFpMetrics(fpEvents: FpMonkeyEvent[]): FpMetrics | null {
    if (fpEvents.length === 0) {
        return null;
    }

    const startTime = fpEvents[0]!.timeStamp;
    const endTime = fpEvents[fpEvents.length - 1]!.timeStamp;
    const durationMs = Math.max(1, endTime - startTime);
    const intensity = fpEvents.length;
    const density = durationMs > 0 ? intensity / durationMs : 0;

    return {
        distinctFpApis: getDistinctFpApis(fpEvents),
        distinctFpCategories: getDistinctFpCategories(fpEvents),
        intensity: intensity,
        startTime: startTime,
        endTime: endTime,
        durationMs: durationMs,
        density: density,
    };
}

/**
 * A burst's score; `apisLevel` is 'pageBurst' for a burst across all of a page's scripts, whose API
 * signals are full at more. One place and generated code keep the burst's: a place in the code
 * belongs to one script, so they don't add up over scripts like the APIs read do.
 */
function computeSpikeFpScore(spike: FpSpike, metrics: FpMetrics, settings: ScoringSettings, apisLevel: ApisLevel = 'burst'): ScoredParts {
    const maxRequestScore = Math.max(...(spike.httpCorrelations ?? []).map((corr) => corr.suspicionScore || 0), 0);

    const apis = apiSignals(metrics.distinctFpApis, apisLevel, settings);
    const onePlace = onePlaceSum(spike.events, 'burst', settings);
    const generated = generatedCodeSum(spike.events, 'burst', settings);

    return combineParts(
        'burst',
        { ...apis.values, onePlace: onePlace.value, generatedCode: generated.value, dataSent: maxRequestScore },
        settings,
        { ...apis.sums, onePlace, generatedCode: generated }
    );
}

/** True when the host of the script at `url` is a CNAME alias for another site, as seen in the document's requests. */
function servedThroughAlias(url: string, document: DocumentState): boolean {
    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        return false;
    }
    return document.httpRequests.some((request) => request.hostname === host && request.isCnameCloaked);
}

function computeScriptFpScore(script: ScriptState, url: string, document: DocumentState, settings: ScoringSettings): ScoredParts {
    const metrics = script.fpMetrics!;
    const burstScores = script.fpSpikes.map((s) => s.fpMetrics?.score ?? 0);

    // As a fallback for collecting spread out, the script's own API signals count only the APIs its
    // strongest burst didn't read: that burst's APIs, their places and generated code are already
    // counted through it. Reads spread out and those of its other bursts count, so splitting a
    // collection into bursts doesn't hide it.
    const strongest = script.fpSpikes.reduce<FpSpike | null>((best, spike) => ((spike.fpMetrics?.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? spike : best), null);
    const counted = new Set(strongest?.events.map((event) => event.id) ?? []);
    const beyond = script.fpEvents.filter((event) => !counted.has(event.id));
    const apis = apiSignals([...metrics.distinctFpApis].filter((id) => !counted.has(id)), 'script', settings);
    const onePlace = onePlaceSum(beyond, 'script', settings);
    const generated = generatedCodeSum(beyond, 'script', settings);

    return combineParts(
        'script',
        {
            ...apis.values,
            onePlace: onePlace.value,
            strongestBurst: Math.max(...burstScores, 0),
            cnameCloaked: servedThroughAlias(url, document) ? 1 : 0,
            sentThroughAlias: script.fpSpikes.some((spike) => spike.httpCorrelations?.some((c) => c.httpRequest?.isCnameCloaked)) ? 1 : 0,
            generatedCode: generated.value,
        },
        settings,
        { ...apis.sums, onePlace, generatedCode: generated }
    );
}

function computeDocumentFpScore(document: DocumentState, settings: ScoringSettings): ScoredParts {
    const metrics = document.fpMetrics!;
    const scripts = Object.values(document.scripts).filter((s) => s.fpMetrics);

    // As a fallback for collecting split over scripts, the page's own API signals count only the
    // APIs its strongest script didn't read: that script is already counted through it. A page
    // with one collector adds nothing; one whose scripts each collect a part shows the rest here.
    const strongest = scripts.reduce<ScriptState | null>((best, s) => ((s.fpMetrics!.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? s : best), null);
    const counted = new Set(strongest?.fpMetrics?.distinctFpApis ?? []);
    const apis = apiSignals([...metrics.distinctFpApis].filter((id) => !counted.has(id)), 'page', settings);
    // The script reading the most unusual APIs through generated code.
    const generated = scripts
        .map((s) => generatedCodeSum(s.fpEvents, 'page', settings))
        .reduce((most, sum) => (sum.value > most.value ? sum : most), generatedCodeSum([], 'page', settings));

    return combineParts(
        'page',
        {
            ...apis.values,
            strongestScript: Math.max(...scripts.map((s) => s.fpMetrics!.score ?? 0), 0),
            strongestBurst: Math.max(...document.spikes.map((s) => s.fpMetrics?.score ?? 0), 0),
            generatedCode: generated.value,
        },
        settings,
        { ...apis.sums, generatedCode: generated }
    );
}

// Fewer different APIs at a place are just a read, not a collection.
const ONE_PLACE_MIN_APIS = 2;

/**
 * How many unusual APIs are read from a single place in the code: the unusual APIs value (see
 * apisSums) of the place reading the most. Only places reading at least ONE_PLACE_MIN_APIS different
 * APIs count, as every API is read from some place. Everyday APIs count little, so layout code
 * reading innerWidth and innerHeight together adds almost nothing. Calls from generated code count at
 * the place it was generated.
 */
function onePlaceSum(fpEvents: FpMonkeyEvent[], level: ApisLevel, settings: ScoringSettings): ApisSum {
    const byPlace = new Map<string, Set<string>>();
    for (const event of fpEvents) {
        if (event.line == null || event.column == null) continue;
        const place = `${event.scriptUrl}:${event.line}:${event.column}`;
        const apis = byPlace.get(place) ?? new Set<string>();
        apis.add(event.id);
        byPlace.set(place, apis);
    }
    return [...byPlace.values()]
        .filter((apis) => apis.size >= ONE_PLACE_MIN_APIS)
        .map((apis) => apisSums(apis, level, settings).unusual)
        .reduce((most, sum) => (sum.value > most.value ? sum : most), apisSums([], level, settings).unusual);
}

/** The identifying information and unusual APIs signals for the different APIs read (see apisSums). */
function apiSignals(distinctApis: Iterable<string>, level: ApisLevel, settings: ScoringSettings) {
    const { identifying, unusual } = apisSums(distinctApis, level, settings);
    return { values: { identifying: identifying.value, unusualApis: unusual.value }, sums: { identifying, unusualApis: unusual } };
}

/**
 * How much fingerprinting is done by code generated at runtime: the unusual APIs read by it, like the
 * "Unusual fingerprinting APIs" signal. An API counts as soon as one of its calls came from generated code, however
 * many didn't. Counting unusual APIs rather than the share keeps e.g. a template engine reading
 * document.cookie through eval from counting much.
 */
function generatedCodeSum(fpEvents: FpMonkeyEvent[], level: ApisLevel, settings: ScoringSettings): ApisSum {
    const generated = new Set<string>();
    for (const event of fpEvents) {
        if (event.generated) generated.add(event.id);
    }
    return apisSums(generated, level, settings).unusual;
}

function getDistinctFpApis(fpEvents: FpMonkeyEvent[]): Set<string> {
    const apiSet = new Set<string>();
    for (const event of fpEvents) {
        apiSet.add(event.id);
    }

    return apiSet;
}

function getDistinctFpCategories(fpEvents: FpMonkeyEvent[]): Set<string> {
    const categorySet = new Set<string>();
    for (const event of fpEvents) {
        // TODO(bug): event ids come from the page, so an unknown id makes this throw.
        const category = FP_APIS_BY_ID[event.id]!.category;
        categorySet.add(category);
    }

    return categorySet;
}

/** The requests carrying data that the script made from the start of the burst until shortly after it. */
function getCorrelatedHttpCandidates(fpSpike: FpSpike, consolidatedHttps: HttpConsolidatedEvent[], windowMs: number): HttpConsolidatedEvent[] {
    const start = fpSpike.events[0]!.timeStamp;
    const end = fpSpike.events[fpSpike.events.length - 1]!.timeStamp + windowMs;

    return consolidatedHttps.filter((c) => c.httpEvent.timeStamp >= start && c.httpEvent.timeStamp <= end && carriesData(c));
}

// A recorded request's score, worked out again only when what it depends on changes: the request
// it's matched to, the settings, or the request's DNS fields arriving.
const httpScores = new WeakMap<object, { request: object; settings: ScoringSettings; enriched: boolean; score: number }>();

function httpFpScore(consolidatedHttp: HttpConsolidatedEvent, settings: ScoringSettings): number {
    const { httpEvent, httpRequest } = consolidatedHttp;
    const enriched = httpRequest.cNameDepth !== undefined;
    const known = httpScores.get(httpEvent);
    if (known && known.request === httpRequest && known.settings === settings && known.enriched === enriched) return known.score;
    const score = computeHttpFpScore(consolidatedHttp, settings);
    httpScores.set(httpEvent, { request: httpRequest, settings, enriched, score });
    return score;
}

function computeHttpFpScore(consolidatedHttp: HttpConsolidatedEvent, settings: ScoringSettings): number {
    const { httpRequest, httpEvent } = consolidatedHttp;

    return combine(
        'request',
        {
            cnameCloaked: httpRequest.isCnameCloaked ? 1 : 0,
            thirdParty: httpRequest.endsThirdParty ? 1 : 0,
            crossOrigin: httpRequest.isCrossOrigin ? 1 : 0,
            sendsData: ['POST', 'PUT', 'PATCH'].includes(httpEvent.method ?? '') ? 1 : 0,
            parameters: saturate(new URL(httpRequest.url).searchParams.size, LIMITS.request.parameters),
            bodySize: saturate(httpRequest.bodyBytes ?? 0, LIMITS.request.bodyBytes),
        },
        settings
    );
}
