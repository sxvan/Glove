import type { DnsResult, FpMetrics, FpSpike, HttpConsolidatedEvent } from '@/types/analysis';
import type { FpMonkeyEvent } from '@/types/events';
import type { DocumentState, ScriptState } from '@/types/session';
import { placeKey } from './call-stack';
import { carriesData, consolidateHttpEvents, enrichHttpRequestsWithDns, requestIndexOf } from './http-analysis';
import { apisSums, apisSumsBeyond, combineParts, type ApisLevel, type ApisSum, type ApisSums, type ScoredParts, type ScoringSettings } from './scoring';
import { detectSpikes } from './spike-detection';

/**
 * How much an API adds to a burst's API signals, to find the window reading the most (see
 * detectSpikes): its bits (not what it adds beyond overlapping ones) times its rarity to
 * rarityPower, relative to where the signal is full and weighed by its strength. Close to the
 * burst's score, and cheap to add up.
 */
function burstWeight(level: 'burst' | 'pageBurst', settings: ScoringSettings): (apiId: string) => number {
    const { rareIdentifying } = settings.strengths.burst;
    const fullAt = settings.fullAt[level];
    return (id) => {
        const traits = settings.apis[id];
        if (!traits || fullAt.rareIdentifying <= 0) return 0;
        return (rareIdentifying * traits.bits * traits.rarity ** Math.max(0, settings.rarityPower)) / fullAt.rareIdentifying;
    };
}

/** Scores the document's scripts, their bursts of calls and the requests right after (see scoring). */
export function analyzeDocumentFp(document: DocumentState, dnsResults: Map<string, DnsResult>, settings: ScoringSettings) {
    const documentFpEvents: FpMonkeyEvent[] = [];

    enrichHttpRequestsWithDns(document, dnsResults);
    const requestIndex = requestIndexOf(document);

    for (const [url, script] of Object.entries(document.scripts)) {
        if (script.fpEvents.length === 0) {
            continue;
        }

        documentFpEvents.push(...script.fpEvents);

        script.httpConsolidatedEvents = consolidateHttpEvents(script.httpEvents, document.httpRequests, requestIndex);

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
            // Its calls as counted when they arrived (see storeFpEvent).
            script.fpMetrics.intensity = Math.max(script.fpMetrics.intensity, script.callCount);
            setScore(script.fpMetrics, computeScriptFpScore(script, url, document, settings));
        }
    }

    // Page bursts: the other scripts reading together, on top of the strongest script, which the
    // page score counts in full. Found in their calls only, so the window isn't the strongest
    // script's own burst again; APIs it read weigh nothing in finding them, and count only for what
    // they reveal more (see apisSumsBeyond).
    const strongest = strongestScript(document);
    const known = new Set(strongest?.fpMetrics?.distinctFpApis ?? []);
    // Scripts without calls were skipped above, so they have no requests matched either.
    const others = Object.values(document.scripts).filter((script) => script !== strongest && script.fpEvents.length > 0);
    const weight = burstWeight('pageBurst', settings);
    document.spikes = detectSpikes(
        others.flatMap((script) => script.fpEvents),
        settings.bursts,
        (id) => (known.has(id) ? 0 : weight(id))
    );
    const othersHttpEvents = others.flatMap((script) => script.httpConsolidatedEvents);
    for (const spike of document.spikes) {
        spike.httpCorrelations = getCorrelatedHttpCandidates(spike, othersHttpEvents, settings.bursts.requestWindowMs);
        spike.fpMetrics = getFpMetrics(spike.events);
        if (spike.fpMetrics) {
            setScore(spike.fpMetrics, computeSpikeFpScore(spike, spike.fpMetrics, settings, 'pageBurst', known));
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

function getFpMetrics(fpEvents: FpMonkeyEvent[]): FpMetrics | null {
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
 * A burst's score; `apisLevel` is 'pageBurst' for a burst of the page's other scripts, whose
 * signals count on top of the APIs `known` (the strongest script's): what they reveal beyond them
 * (see apisSumsBeyond), and of one place and generated code only the APIs not known. One place and
 * generated code keep the burst's level: a place in the code belongs to one script, so they don't
 * add up over scripts like the APIs read do.
 */
function computeSpikeFpScore(spike: FpSpike, metrics: FpMetrics, settings: ScoringSettings, apisLevel: ApisLevel = 'burst', known?: Set<string>): ScoredParts {
    const apis = known ? apiSignalsBeyond(known, metrics.distinctFpApis, apisLevel, settings) : apiSignals(metrics.distinctFpApis, apisLevel, settings);
    const events = known ? spike.events.filter((event) => !known.has(event.id)) : spike.events;
    const onePlace = onePlaceSum(events, 'burst', settings);
    const generated = generatedCodeSum(events, 'burst', settings);

    return combineParts(
        'burst',
        { ...apis.values, onePlace: onePlace.value, generatedCode: generated.value },
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

    // A fallback for collecting spread out: the script's own API signals count only what it read
    // beyond its strongest burst, which counted the rest, on top of what the burst revealed (see
    // apisSumsBeyond). So splitting a collection into several bursts doesn't hide it.
    const strongest = script.fpSpikes.reduce<FpSpike | null>((best, spike) => ((spike.fpMetrics?.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? spike : best), null);
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
                sentThroughAlias: script.fpSpikes.some((spike) => spike.httpCorrelations?.some((c) => c.httpRequest?.isCnameCloaked)) ? 1 : 0,
            },
            settings
        ),
        { beyondBurst }
    );
}

/** `scored` with the parts of the signals that are scores of their own (see SignalPart.parts). */
function withParts(scored: ScoredParts, parts: Record<string, ScoredParts>): ScoredParts {
    for (const [key, part] of Object.entries(parts)) scored.parts[key]!.parts = part.parts;
    return scored;
}

/** The script with the highest score, which the page score counts in full; null without scored scripts. */
function strongestScript(document: DocumentState): ScriptState | null {
    return Object.values(document.scripts)
        .filter((s) => s.fpMetrics)
        .reduce<ScriptState | null>((best, s) => ((s.fpMetrics!.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? s : best), null);
}

function computeDocumentFpScore(document: DocumentState, settings: ScoringSettings): ScoredParts {
    const metrics = document.fpMetrics!;

    // The page in two parts, each API in one only: the strongest script in full, and the other
    // scripts on top of it, scored like a script: their strongest burst (see analyzeDocumentFp),
    // and what they read outside it, on top of the strongest script and the burst (see
    // apisSumsBeyond). A page with one collector adds nothing; one whose scripts each collect a
    // part shows it here.
    const strongest = strongestScript(document);
    const burst = document.spikes.reduce<FpSpike | null>((best, spike) => ((spike.fpMetrics?.score ?? 0) > (best?.fpMetrics?.score ?? 0) ? spike : best), null);
    const known = new Set([...(strongest?.fpMetrics?.distinctFpApis ?? []), ...(burst?.fpMetrics?.distinctFpApis ?? [])]);
    const others = Object.values(document.scripts).filter((s) => s.fpMetrics && s !== strongest);
    const apis = apiSignalsBeyond(known, metrics.distinctFpApis, 'page', settings);
    // Like a script's beyond its burst: one place and generated code only for the APIs not known,
    // which leaves the burst's calls out too. A place belongs to one script; generated code counts
    // for the other script reading the most unusual APIs through it.
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
 * How many rare identifying APIs are read from a single place in the code: the rare identifying
 * value (see apisSums) of the place reading the most. Only places reading at least
 * ONE_PLACE_MIN_APIS different APIs count, as every API is read from some place. Everyday APIs count
 * little, so layout code reading innerWidth and innerHeight together adds almost nothing. Calls from
 * generated code count at their place inside it (see placeKey), so a piece of generated code isn't
 * one place just because it was generated at one.
 */
function onePlaceSum(fpEvents: FpMonkeyEvent[], level: ApisLevel, settings: ScoringSettings): ApisSum {
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

/**
 * How much fingerprinting is done by code generated at runtime: the rare identifying APIs read by
 * it, like the "Rare identifying fingerprinting APIs" signal. An API counts as soon as one of its
 * calls came from generated code, however many didn't. Counting rare identifying APIs rather than
 * the share keeps e.g. a template engine reading document.cookie through eval from counting much.
 */
function generatedCodeSum(fpEvents: FpMonkeyEvent[], level: ApisLevel, settings: ScoringSettings): ApisSum {
    const generated = new Set<string>();
    for (const event of fpEvents) {
        if (event.generated) generated.add(event.id);
    }
    return apisSums(generated, level, settings).rareIdentifying;
}

function getDistinctFpApis(fpEvents: FpMonkeyEvent[]): Set<string> {
    const apiSet = new Set<string>();
    for (const event of fpEvents) {
        apiSet.add(event.id);
    }

    return apiSet;
}

/** The requests carrying data that the script made from the start of the burst until shortly after it. */
function getCorrelatedHttpCandidates(fpSpike: FpSpike, consolidatedHttps: HttpConsolidatedEvent[], windowMs: number): HttpConsolidatedEvent[] {
    const start = fpSpike.events[0]!.timeStamp;
    const end = fpSpike.events[fpSpike.events.length - 1]!.timeStamp + windowMs;

    return consolidatedHttps.filter((c) => c.httpEvent.timeStamp >= start && c.httpEvent.timeStamp <= end && carriesData(c));
}

