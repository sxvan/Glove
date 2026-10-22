import type { DnsResult, FpMetrics, FpBurst, HttpConsolidatedEvent } from '@/types/analysis';
import type { ApiCallEvent } from '@/types/events';
import type { DocumentState, ScriptState } from '@/types/session';
import { placeKey } from './call-stack';
import { carriesData, consolidateHttpEvents, enrichHttpRequestsWithDns, requestIndexOf } from './http-analysis';
import { apisSums, apisSumsBeyond, combineParts, type ApisLevel, type ApisSum, type ApisSums, type ScoredParts, type ScoringSettings } from './scoring';
import { detectBursts } from './burst-detection';

// Finds the window reading the most: close to the burst's score, but cheap to add up (bits, not what
// they add beyond overlapping APIs).
function burstWeight(level: 'burst' | 'pageBurst', settings: ScoringSettings): (apiId: string) => number {
    const { rareIdentifying } = settings.strengths.burst;
    const fullAt = settings.fullAt[level];
    return (id) => {
        const traits = settings.apis[id];
        if (!traits || fullAt.rareIdentifying <= 0) return 0;
        return (rareIdentifying * traits.bits * traits.rarity ** Math.max(0, settings.rarityPower)) / fullAt.rareIdentifying;
    };
}

export function analyzeDocumentFp(document: DocumentState, dnsResults: Map<string, DnsResult>, settings: ScoringSettings) {
    const documentFpEvents: ApiCallEvent[] = [];

    enrichHttpRequestsWithDns(document, dnsResults);
    const requestIndex = requestIndexOf(document);

    for (const [url, script] of Object.entries(document.scripts)) {
        if (script.fpEvents.length === 0) {
            continue;
        }

        documentFpEvents.push(...script.fpEvents);

        script.httpConsolidatedEvents = consolidateHttpEvents(script.httpEvents, document.httpRequests, requestIndex);

        script.bursts = detectBursts(script.fpEvents, settings.bursts, burstWeight('burst', settings));

        for (const burst of script.bursts) {
            burst.httpCorrelations = getCorrelatedHttpCandidates(burst, script.httpConsolidatedEvents, settings.bursts.requestWindowMs);
            burst.fpMetrics = getFpMetrics(burst.events);
            if (burst.fpMetrics) {
                setScore(burst.fpMetrics, computeBurstFpScore(burst, burst.fpMetrics, settings));
            }
        }

        script.fpMetrics = getFpMetrics(script.fpEvents);
        if (script.fpMetrics) {
            // Its calls as counted when they arrived (see storeFpEvent).
            script.fpMetrics.intensity = Math.max(script.fpMetrics.intensity, script.callCount);
            setScore(script.fpMetrics, computeScriptFpScore(script, url, document, settings));
        }
    }

    // Page bursts are found in the other scripts' calls only, so the window isn't the strongest
    // script's burst again; APIs it read weigh nothing (see apisSumsBeyond).
    const strongest = strongestScript(document);
    const known = new Set(strongest?.fpMetrics?.distinctFpApis ?? []);
    // Scripts without calls were skipped above, so they have no requests matched either.
    const others = Object.values(document.scripts).filter((script) => script !== strongest && script.fpEvents.length > 0);
    const weight = burstWeight('pageBurst', settings);
    document.bursts = detectBursts(
        others.flatMap((script) => script.fpEvents),
        settings.bursts,
        (id) => (known.has(id) ? 0 : weight(id))
    );
    const othersHttpEvents = others.flatMap((script) => script.httpConsolidatedEvents);
    for (const burst of document.bursts) {
        burst.httpCorrelations = getCorrelatedHttpCandidates(burst, othersHttpEvents, settings.bursts.requestWindowMs);
        burst.fpMetrics = getFpMetrics(burst.events);
        if (burst.fpMetrics) {
            setScore(burst.fpMetrics, computeBurstFpScore(burst, burst.fpMetrics, settings, 'pageBurst', known));
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
}

function setScore(metrics: FpMetrics, scored: ScoredParts) {
    metrics.score = scored.score;
    metrics.signals = scored.parts;
}

function getFpMetrics(fpEvents: ApiCallEvent[]): FpMetrics | null {
    if (fpEvents.length === 0) {
        return null;
    }

    return {
        distinctFpApis: getDistinctFpApis(fpEvents),
        intensity: fpEvents.length,
        durationMs: Math.max(1, fpEvents[fpEvents.length - 1]!.timeStamp - fpEvents[0]!.timeStamp),
    };
}

/**
 * `known`: for a page burst, the strongest script's APIs, which it counts on top of. One place and
 * generated code keep the burst's level: a place in the code belongs to one script.
 */
function computeBurstFpScore(burst: FpBurst, metrics: FpMetrics, settings: ScoringSettings, apisLevel: ApisLevel = 'burst', known?: Set<string>): ScoredParts {
    const apis = known ? apiSignalsBeyond(known, metrics.distinctFpApis, apisLevel, settings) : apiSignals(metrics.distinctFpApis, apisLevel, settings);
    const events = known ? burst.events.filter((event) => !known.has(event.id)) : burst.events;
    const onePlace = onePlaceSum(events, 'burst', settings);
    const generated = generatedCodeSum(events, 'burst', settings);

    return combineParts(
        'burst',
        { ...apis.values, onePlace: onePlace.value, generatedCode: generated.value },
        settings,
        { ...apis.sums, onePlace, generatedCode: generated }
    );
}

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
    const burstScores = script.bursts.map((s) => s.fpMetrics?.score ?? 0);

    // Beyond its strongest burst, so splitting a collection into several bursts doesn't hide it.
    const strongest = script.bursts.reduce<FpBurst | null>((best, burst) => ((burst.fpMetrics?.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? burst : best), null);
    const counted = new Set(strongest?.events.map((event) => event.id) ?? []);
    const beyond = script.fpEvents.filter((event) => !counted.has(event.id));
    const apis = apiSignalsBeyond(counted, metrics.distinctFpApis, 'script', settings);
    const onePlace = onePlaceSum(beyond, 'script', settings);
    const generated = generatedCodeSum(beyond, 'script', settings);

    const beyondBurst = combineParts(
        'scriptBeyondBurst',
        { ...apis.values, onePlace: onePlace.value, generatedCode: generated.value },
        settings,
        { ...apis.sums, onePlace, generatedCode: generated }
    );
    return withParts(
        combineParts(
            'script',
            {
                strongestBurst: Math.max(...burstScores, 0),
                beyondBurst: beyondBurst.score,
                cnameCloaked: servedThroughAlias(url, document) ? 1 : 0,
                sentThroughAlias: script.bursts.some((burst) => burst.httpCorrelations?.some((c) => c.httpRequest?.isCnameCloaked)) ? 1 : 0,
            },
            settings
        ),
        { beyondBurst }
    );
}

function withParts(scored: ScoredParts, parts: Record<string, ScoredParts>): ScoredParts {
    for (const [key, part] of Object.entries(parts)) scored.parts[key]!.parts = part.parts;
    return scored;
}

function strongestScript(document: DocumentState): ScriptState | null {
    return Object.values(document.scripts)
        .filter((s) => s.fpMetrics)
        .reduce<ScriptState | null>((best, s) => ((s.fpMetrics!.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? s : best), null);
}

function computeDocumentFpScore(document: DocumentState, settings: ScoringSettings): ScoredParts {
    const metrics = document.fpMetrics!;

    // Each API counts in one part only: a page with one collector adds nothing here, one whose scripts
    // each collect a part shows it.
    const strongest = strongestScript(document);
    const burst = document.bursts.reduce<FpBurst | null>((best, burst) => ((burst.fpMetrics?.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? burst : best), null);
    const known = new Set([...(strongest?.fpMetrics?.distinctFpApis ?? []), ...(burst?.fpMetrics?.distinctFpApis ?? [])]);
    const others = Object.values(document.scripts).filter((s) => s.fpMetrics && s !== strongest);
    const apis = apiSignalsBeyond(known, metrics.distinctFpApis, 'page', settings);
    // A place belongs to one script; generated code counts for the script reading the most through it.
    const beyond = others.map((s) => s.fpEvents.filter((event) => !known.has(event.id)));
    const onePlace = onePlaceSum(beyond.flat(), 'page', settings);
    const generated = beyond
        .map((events) => generatedCodeSum(events, 'page', settings))
        .reduce((most, sum) => (sum.value > most.value ? sum : most), generatedCodeSum([], 'page', settings));
    const beyondBurst = combineParts(
        'otherScriptsBeyondBurst',
        { ...apis.values, onePlace: onePlace.value, generatedCode: generated.value },
        settings,
        { ...apis.sums, onePlace, generatedCode: generated }
    );
    const other = withParts(combineParts('otherScripts', { strongestBurst: burst?.fpMetrics?.score ?? 0, beyondBurst: beyondBurst.score }, settings), { beyondBurst });

    return withParts(combineParts('page', { strongestScript: strongest?.fpMetrics?.score ?? 0, otherScripts: other.score }, settings), { otherScripts: other });
}

// Fewer different APIs at a place are just a read, not a collection.
const ONE_PLACE_MIN_APIS = 2;

/**
 * The place reading the most. Everyday APIs count little, so layout code reading innerWidth and
 * innerHeight together adds almost nothing. Generated code counts at its places inside (placeKey), so
 * it isn't one place just because it was generated at one.
 */
function onePlaceSum(fpEvents: ApiCallEvent[], level: ApisLevel, settings: ScoringSettings): ApisSum {
    const byPlace = new Map<string, Set<string>>();
    for (const event of fpEvents) {
        if (event.line == null || event.column == null) continue;
        const place = `${event.scriptUrl}:${placeKey(event)}`;
        const apis = byPlace.get(place) ?? new Set<string>();
        apis.add(event.id);
        byPlace.set(place, apis);
    }
    return [...byPlace.values()]
        .filter((apis) => apis.size >= ONE_PLACE_MIN_APIS)
        .map((apis) => apisSums(apis, level, settings).rareIdentifying)
        .reduce((most, sum) => (sum.value > most.value ? sum : most), apisSums([], level, settings).rareIdentifying);
}

function apiSignalsBeyond(known: Iterable<string>, distinctApis: Iterable<string>, level: ApisLevel, settings: ScoringSettings) {
    return apiSignalsOf(apisSumsBeyond(known, distinctApis, level, settings));
}

function apiSignals(distinctApis: Iterable<string>, level: ApisLevel, settings: ScoringSettings) {
    return apiSignalsOf(apisSums(distinctApis, level, settings));
}

function apiSignalsOf({ rareIdentifying }: ApisSums) {
    return { values: { rareIdentifying: rareIdentifying.value }, sums: { rareIdentifying } };
}

// Rare bits rather than the share, so a template engine reading document.cookie through eval counts little.
function generatedCodeSum(fpEvents: ApiCallEvent[], level: ApisLevel, settings: ScoringSettings): ApisSum {
    const generated = new Set<string>();
    for (const event of fpEvents) {
        if (event.generated) generated.add(event.id);
    }
    return apisSums(generated, level, settings).rareIdentifying;
}

function getDistinctFpApis(fpEvents: ApiCallEvent[]): Set<string> {
    const apiSet = new Set<string>();
    for (const event of fpEvents) {
        apiSet.add(event.id);
    }

    return apiSet;
}

function getCorrelatedHttpCandidates(burst: FpBurst, consolidatedHttps: HttpConsolidatedEvent[], windowMs: number): HttpConsolidatedEvent[] {
    const start = burst.events[0]!.timeStamp;
    const end = burst.events[burst.events.length - 1]!.timeStamp + windowMs;

    return consolidatedHttps.filter((c) => c.httpEvent.timeStamp >= start && c.httpEvent.timeStamp <= end && carriesData(c));
}

