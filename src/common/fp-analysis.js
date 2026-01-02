import { FP_APIS_BY_ID, FP_TOTAL_WEIGHT, FP_CATEGORIES_TOTAL_WEIGHT, FP_CATEGORY_WEIGHTS } from './fp-apis.js';
import { consolidateHttpEvents, getEnrichedHttpRequestsWithDns } from './http-analysis.js';
import { detectSpikes } from './spike-detection.js';

/**
 * @param {DocumentState} document
 * @param {Map<string, DnsResult>} dnsResults
 */
export function analyzeDocumentFp(document, dnsResults) {
    const documentFpEvents = [];
    const documentConsolidatedHttpEvents = [];

    document.httpRequests = getEnrichedHttpRequestsWithDns(document, dnsResults);

    for (const script of Object.values(document.scripts)) {
        if (script.fpEvents.length === 0) {
            continue;
        }

        documentFpEvents.push(...script.fpEvents);

        script.httpConsolidatedEvents = consolidateHttpEvents(script.httpEvents, document.httpRequests);

        for (const consolidatedHttp of script.httpConsolidatedEvents) {
            consolidatedHttp.suspicionScore = computeHttpFpScore(consolidatedHttp);
        }

        documentConsolidatedHttpEvents.push(...script.httpConsolidatedEvents);

        script.fpSpikes = detectSpikes(script.fpEvents);

        for (const spike of script.fpSpikes) {
            spike.httpCorrelations = getCorrelatedHttpCandidates(spike, script.httpConsolidatedEvents);
            spike.fpMetrics = getFpMetrics(spike.events);
            if (spike.fpMetrics) {
                spike.fpMetrics.score = computeSpikeFpScore(spike, spike.fpMetrics);
            }
        }

        script.fpMetrics = getFpMetrics(script.fpEvents);
        if (script.fpMetrics) {
            script.fpMetrics.score = computeScriptFpScore(script);
        }
    }

    document.spikes = detectSpikes(documentFpEvents);
    for (const spike of document.spikes) {
        spike.httpCorrelations = getCorrelatedHttpCandidates(spike, documentConsolidatedHttpEvents);
        spike.fpMetrics = getFpMetrics(spike.events);
        if (spike.fpMetrics) {
            spike.fpMetrics.score = computeSpikeFpScore(spike, spike.fpMetrics);
        }
    }

    document.fpMetrics = getFpMetrics(documentFpEvents);
    if (document.fpMetrics) {
        document.fpMetrics.score = computeDocumentFpScore(document);
    }
    console.log(document);
}

/**
 *
 * @param {FpMonkeyEvent[]} fpEvents
 * @returns {FpMetrics}
 */
function getFpMetrics(fpEvents) {
    if (fpEvents.length === 0) {
        return null;
    }

    const startTime = fpEvents[0].timeStamp;
    const endTime = fpEvents[fpEvents.length - 1].timeStamp;
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
 * @param {FpSpike} spike
 * @param {FpMetrics} metrics
 */
function computeSpikeFpScore(spike, metrics) {
    const distinctApiScorePure = getDistinctFpApiScorePure(metrics.distinctFpApis);
    const distinctCategoryScorePure = getDistinctFpApiCategoryScorePure(metrics.distinctFpCategories);

    const DENSITY_SAT = 1;
    const INTENSITY_SAT = 10;
    const DISTINCT_API_SAT = 0.4;
    const DISTINCT_CATEGORY_SAT = 0.5;

    const distinctApiScore = Math.min(distinctApiScorePure / DISTINCT_API_SAT, 1);
    const distinctCategoryScore = Math.min(distinctCategoryScorePure / DISTINCT_CATEGORY_SAT, 1);

    const intensityScore = Math.min(metrics.intensity / INTENSITY_SAT, 1);
    const densityScore = Math.min(metrics.density / DENSITY_SAT, 1);

    const maxHttpSuspicionScore = Math.max(...spike.httpCorrelations.map((corr) => corr.suspicionScore || 0), 0);

    const totalScore = 0.35 * distinctApiScore + 0.25 * distinctCategoryScore + 0.2 * maxHttpSuspicionScore + 0.15 * densityScore + 0.05 * intensityScore;

    return totalScore;
}

/**
 * @param {ScriptState} script
 */
function computeScriptFpScore(script) {
    const footprintScore = computeScriptFootprintScore(script);
    const spikeSummary = summarizeSpikeScores(script.fpSpikes);

    return 0.5 * footprintScore + 0.35 * spikeSummary.maxSpike + 0.15 * spikeSummary.highSpikeFeature + 0.05 * spikeSummary.mediumSpikeFeature;
}

/**
 *
 * @param {ScriptState} script
 * @returns {number}
 */
function computeScriptFootprintScore(script) {
    const INTENSITY_SAT = 200;
    const DISTINCT_API_SAT = 0.6;
    const DISTINCT_CATEGORY_SAT = 0.7;

    const distinctApiScorePure = getDistinctFpApiScorePure(script.fpMetrics.distinctFpApis);
    const distinctCategoryScorePure = getDistinctFpApiCategoryScorePure(script.fpMetrics.distinctFpCategories);

    const intensityScore = Math.min(script.fpMetrics.intensity / INTENSITY_SAT, 1);
    const distinctApiScore = Math.min(distinctApiScorePure / DISTINCT_API_SAT, 1);
    const distinctCategoryScore = Math.min(distinctCategoryScorePure / DISTINCT_CATEGORY_SAT, 1);

    return 0.55 * distinctApiScore + 0.35 * distinctCategoryScore + 0.1 * intensityScore;
}

/**
 * @param {FpSpike[]} spikes
 */
function summarizeSpikeScores(spikes) {
    if (!spikes || spikes.length === 0) {
        return { maxSpike: 0, highSpikeFeature: 0, mediumSpikeFeature: 0 };
    }

    const HIGH_SPIKE_THRESHOLD = 0.7;
    const MEDIUM_SPIKE_THRESHOLD = 0.5;

    const scores = spikes.map((s) => s.fpMetrics.score ?? 0).sort((a, b) => b - a);

    const maxSpike = scores[0] || 0;
    const highSpikeCount = scores.filter((s) => s >= HIGH_SPIKE_THRESHOLD).length;
    const mediumSpikeCount = scores.filter((s) => s >= MEDIUM_SPIKE_THRESHOLD && s < HIGH_SPIKE_THRESHOLD).length;

    const HIGH_SPIKE_SAT = 3;
    const MEDIUM_SPIKE_SAT = 5;

    const highSpikeFeature = Math.min(highSpikeCount / HIGH_SPIKE_SAT, 1);
    const mediumSpikeFeature = Math.min(mediumSpikeCount / MEDIUM_SPIKE_SAT, 1);

    return { maxSpike, highSpikeFeature, mediumSpikeFeature };
}

/**
 * @param {DocumentState} document
 * @returns {number}
 */
function computeDocumentFootprintScore(document) {
    const INTENSITY_SAT = 500;
    const DISTINCT_API_SAT = 0.7;
    const DISTINCT_CATEGORY_SAT = 0.8;

    const distinctApiScorePure = getDistinctFpApiScorePure(document.fpMetrics.distinctFpApis);
    const distinctCategoryScorePure = getDistinctFpApiCategoryScorePure(document.fpMetrics.distinctFpCategories);

    const intensityScore = Math.min(document.fpMetrics.intensity / INTENSITY_SAT, 1);
    const distinctApiScore = Math.min(distinctApiScorePure / DISTINCT_API_SAT, 1);
    const distinctCategoryScore = Math.min(distinctCategoryScorePure / DISTINCT_CATEGORY_SAT, 1);

    return 0.55 * distinctApiScore + 0.35 * distinctCategoryScore + 0.1 * intensityScore;
}

/**
 *
 * @param {DocumentState} document
 * @returns {number}
 */
function computeDocumentFpScore(document) {
    const footprintScore = computeDocumentFootprintScore(document);
    const spikeSummary = summarizeSpikeScores(document.spikes);
    const scriptSummary = summarizeScriptScores(Object.values(document.scripts));

    return (
        0.4 * footprintScore +
        0.3 * spikeSummary.maxSpike +
        0.2 * scriptSummary.maxScript +
        0.05 * spikeSummary.highSpikeFeature +
        0.03 * scriptSummary.highScriptFeature +
        0.02 * spikeSummary.mediumSpikeFeature +
        0.01 * scriptSummary.mediumScriptFeature
    );
}

/**
 * @param {ScriptState[]} scripts
 */
function summarizeScriptScores(scripts) {
    if (!scripts || scripts.length === 0) {
        return { maxScript: 0, highScriptFeature: 0, mediumScriptFeature: 0 };
    }

    const HIGH_SCRIPT_THRESHOLD = 0.7;
    const MEDIUM_SCRIPT_THRESHOLD = 0.5;

    const scores = scripts
        .filter((s) => s.fpMetrics)
        .map((s) => s.fpMetrics.score ?? 0)
        .sort((a, b) => b - a);

    const maxScript = scores[0] || 0;
    const highScriptCount = scores.filter((s) => s >= HIGH_SCRIPT_THRESHOLD).length;
    const mediumScriptCount = scores.filter((s) => s >= MEDIUM_SCRIPT_THRESHOLD && s < HIGH_SCRIPT_THRESHOLD).length;

    const HIGH_SCRIPT_SAT = 3;
    const MEDIUM_SCRIPT_SAT = 5;

    const highScriptFeature = Math.min(highScriptCount / HIGH_SCRIPT_SAT, 1);
    const mediumScriptFeature = Math.min(mediumScriptCount / MEDIUM_SCRIPT_SAT, 1);

    return { maxScript, highScriptFeature, mediumScriptFeature };
}

/**
 * @param {FpMonkeyEvent[]} fpEvents
 */
function getDistinctFpApis(fpEvents) {
    const apiSet = new Set();
    for (const event of fpEvents) {
        apiSet.add(event.id);
    }

    return apiSet;
}

/**
 * @param {FpMonkeyEvent[]} fpEvents
 */
function getDistinctFpCategories(fpEvents) {
    const categorySet = new Set();
    for (const event of fpEvents) {
        const category = FP_APIS_BY_ID[event.id].category;
        categorySet.add(category);
    }

    return categorySet;
}

/**
 * @param {Set<string>} distinctFpApis
 */
function getDistinctFpApiScorePure(distinctFpApis) {
    let combinedWeight = 0;
    for (const apiId of distinctFpApis) {
        const api = FP_APIS_BY_ID[apiId];
        combinedWeight += api.weight;
    }

    return combinedWeight / FP_TOTAL_WEIGHT;
}

/**
 * @param {Set<string>} distinctFpCategories
 */
function getDistinctFpApiCategoryScorePure(distinctFpCategories) {
    let combinedWeight = 0;
    for (const category of distinctFpCategories) {
        combinedWeight += FP_CATEGORY_WEIGHTS[category];
    }

    return combinedWeight / FP_CATEGORIES_TOTAL_WEIGHT;
}

/**
 * @param {FpSpike} fpSpike
 * @param {HttpConsolidatedEvent[]} consolidatedHttps
 * @param {number} preWindowMs
 * @param {number} postWindowMs
 */
function getCorrelatedHttpCandidates(fpSpike, consolidatedHttps, preWindowMs = 0, postWindowMs = 200) {
    const start = fpSpike.events[0].timeStamp - preWindowMs;
    const end = fpSpike.events[fpSpike.events.length - 1].timeStamp + postWindowMs;

    const correlated = consolidatedHttps.filter((c) => c.httpEvent.timeStamp >= start && c.httpEvent.timeStamp <= end);

    return correlated;
}

/**
 * @param {HttpConsolidatedEvent} consolidatedHttp
 */
function computeHttpFpScore(consolidatedHttp) {
    const WEIGHTS = {
        cnameCloaked: 0.3,
        thirdParty: 0.2,
        crossOrigin: 0.15,
        susMethod: 0.15,
        searchParams: 0.1,
        type: 0.1,
    };

    const isCnameCloaked = consolidatedHttp.httpRequest.isCnameCloaked ? 1 : 0;
    const isCrossOrigin = consolidatedHttp.httpRequest.isCrossOrigin ? 1 : 0;
    const isThirdParty = consolidatedHttp.httpRequest.endsThirdParty ? 1 : 0;
    const isSusMethod = ['POST', 'PUT', 'PATCH'].includes(consolidatedHttp.httpEvent.method) ? 1 : 0;
    const typeSuspicion = getTypeSuspicion(consolidatedHttp.httpRequest.type);

    const SEARCH_PARAMS_SAT = 5;
    const searchParamsNumber = new URL(consolidatedHttp.httpRequest.url).searchParams.size;

    const searchParamsScore = Math.min(searchParamsNumber / SEARCH_PARAMS_SAT, 1);

    return (
        WEIGHTS.cnameCloaked * isCnameCloaked +
        WEIGHTS.crossOrigin * isCrossOrigin +
        WEIGHTS.thirdParty * isThirdParty +
        WEIGHTS.susMethod * isSusMethod +
        WEIGHTS.searchParams * searchParamsScore +
        WEIGHTS.type * typeSuspicion
    );
}

/**
 * @param {string} type
 * @returns {number}
 */
function getTypeSuspicion(type) {
    switch (type) {
        case 'xmlhttprequest':
        case 'ping':
            return 1.0;

        case 'websocket':
        case 'csp_report':
            return 0.8;

        case 'other':
        case 'media':
        case 'webbundle':
            return 0.5;

        case 'script':
        case 'main_frame':
        case 'sub_frame':
            return 0.2;

        case 'image':
        case 'font':
        case 'stylesheet':
        case 'object':
        default:
            return 0.1;
    }
}
