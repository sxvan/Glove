// Reduces a TabSnapshot to the three tracking categories the popup shows, each with a likelihood,
// key numbers and the strongest evidence.
import { placeKey } from '@/lib/call-stack';
import { FP_APIS, FP_APIS_BY_ID, fpCategoryName } from '@/lib/fp-apis';
import { getEtld1 } from '@/lib/http-utils';
import { DEFAULT_SETTINGS, SIGNALS, SIGNAL_SOURCES, identifyingBits as addedUpBits, rareAmounts, rareIdentifyingBits, type ApiAmount, type ApiTraits, type ApisSum, type ScoreLevel, type ScoringSettings, type SignalPart } from '@/lib/scoring';
import type { ViewerApi, ViewerParams } from '@/lib/script-viewer';
import type { HttpConsolidatedEvent } from '@/types/analysis';
import type { CallLocation, DocumentSnapshot, MetricsSnapshot, ScriptSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';
import { duration, listWords, plural } from './format';

/** How likely tracking is; "unknown" while nothing was recorded for the tab yet. */
export type Likelihood = 'unknown' | 'unlikely' | 'possible' | 'likely';

export const LIKELIHOOD_LABELS: Record<Likelihood, string> = {
    unknown: 'Unknown',
    unlikely: 'Unlikely',
    possible: 'Possible',
    likely: 'Likely',
};

export interface Category {
    id: 'fingerprinting' | 'cname' | 'dns';
    title: string;
    /** Plain-language explanation, shown behind the info icon. */
    explanation: string;
    likelihood: Likelihood;
    /** The category's score from 0 to 1, shown as a bar; null where there is none, e.g. for CNAME aliases. */
    score: number | null;
    /** One line about what was observed. */
    summary: string;
    /** Signs of hiding that any of the category's scripts show; empty if there are none. */
    signals: string[];
    /** The strongest evidence: scripts or hosts, most suspicious first. */
    rows: EvidenceRow[];
    /** Further evidence not in `rows`. */
    moreRows: number;
}

/** A script or host on the overview. */
export interface EvidenceRow {
    key: string;
    /** A script name or hostname, shown in monospace. */
    name: string;
    /** True when the name is a URL path: its file name (from the last "/") always shows. */
    path: boolean;
    /** E.g. the script's host, or the site an alias leads to; may be empty. */
    detail: string;
    /** Full text for the tooltip, e.g. the script URL or the alias chain. */
    title: string;
    likelihood: Likelihood | null;
    /** How suspicious it is, from 0 to 1; null where there is no score, e.g. for CNAME aliases. */
    score: number | null;
}

/** Where scores count as possible or likely: the user's settings, sent with the snapshot. */
function cutoffsOf(snapshot: TabSnapshot): ScoringSettings['cutoffs'] {
    return snapshot.cutoffs ?? DEFAULT_SETTINGS.cutoffs;
}

/**
 * Each API's bits and rarity as the scores were made with them: the user's settings, sent with
 * the snapshot, so the popup ranks and shows APIs as it scores them. An older background doesn't
 * send them; the defaults stand in then.
 */
function traitsOf(snapshot: TabSnapshot): Record<string, ApiTraits> {
    return snapshot.apis ?? DEFAULT_SETTINGS.apis;
}

/** The exponent rarity counts with, likewise. */
function rarityPowerOf(snapshot: TabSnapshot): number {
    return snapshot.rarityPower ?? DEFAULT_SETTINGS.rarityPower;
}

/**
 * Each API's rare bits read alone: its bits times its rarity to the exponent, what it counts toward
 * the score. For listing kinds of detail by what makes a script suspicious, not by what reveals most.
 */
function rareBitsOf(snapshot: TabSnapshot): Record<string, number> {
    const power = Math.max(0, rarityPowerOf(snapshot));
    return Object.fromEntries(Object.entries(traitsOf(snapshot)).map(([id, traits]) => [id, Math.max(0, traits.bits) * Math.min(1, Math.max(0, traits.rarity)) ** power]));
}

/** Evidence rows per category on the overview. */
const OVERVIEW_ROWS = 3;

export function pageUrl(snapshot: TabSnapshot): string | null {
    const frames = (snapshot.frames ?? []).filter((f) => f !== null);
    return (frames.find((f) => f.frameId === '0') ?? frames[0])?.document.url ?? null;
}

export function pageHost(snapshot: TabSnapshot): string {
    const url = pageUrl(snapshot);
    return hostOf(url) || url || '';
}

export function buildCategories(snapshot: TabSnapshot): Category[] {
    return [fingerprinting(snapshot), cnameCloaking(snapshot), dnsTracking(snapshot)];
}

/** A snapshot of a tab with nothing recorded, for showing the categories before there is data. */
export const EMPTY_SNAPSHOT: TabSnapshot = { cNameRequests: [], dnsTrackingRequests: [], frames: [], cutoffs: DEFAULT_SETTINGS.cutoffs };

/** The categories while nothing was recorded for the tab: each unknown, not checked yet. */
export function unknownCategories(): Category[] {
    return buildCategories(EMPTY_SNAPSHOT).map((category) => ({ ...category, likelihood: 'unknown', score: null, summary: 'Not checked yet', rows: [], signals: [] }));
}

/** The page's fingerprinting card while nothing was recorded for the tab. */
export function unknownPageDetail(): ScriptDetail {
    return { ...fingerprintingPageDetail(EMPTY_SNAPSHOT, []), name: '', likelihood: 'unknown' };
}

export interface Summary {
    headline: string;
    /** Third parties with evidence against them, strongest evidence first. */
    parties: string[];
}

/** Which third parties may be tracking on the page. */
export function buildSummary(snapshot: TabSnapshot): Summary {
    const cutoffs = cutoffsOf(snapshot);
    const pageSite = getEtld1(hostOf(pageUrl(snapshot)));
    const scripts = (snapshot.frames ?? []).filter((f) => f !== null).flatMap((f) => f.document.scripts);

    // A domain counts only with real evidence: a script that fingerprints at "possible" or above,
    // being the real target of a cloaked first-party address, or using ID-like hostnames.
    const aliases = cloakedHosts(snapshot);
    const fingerprinters = scripts.filter((s) => (s.fpMetrics?.score ?? 0) >= cutoffs.fingerprinting.possible).map((s) => realSite(hostOf(s.name), aliases));
    const cloaked = [...aliases.values()].map((target) => getEtld1(target) ?? target);
    const idHosts = unique(
        (snapshot.dnsTrackingRequests ?? []).filter((r) => (r.subdomainScore ?? 0) >= cutoffs.hostname.possible).map((r) => r.hostname ?? hostOf(r.url))
    );

    const parties = unique([...fingerprinters, ...cloaked, ...idHosts.map((h) => getEtld1(h))].filter((s): s is string => !!s && s !== pageSite));
    const siteFingerprints = fingerprinters.some((s) => s === pageSite);

    let headline = 'No signs of tracking so far';
    if (parties.length > 0) headline = `${plural(parties.length, 'third party', 'third parties')} may be tracking you`;
    else if (siteFingerprints) headline = 'The site itself may be fingerprinting you';

    return { headline, parties };
}

function fingerprinting(snapshot: TabSnapshot): Category {
    const cutoffs = cutoffsOf(snapshot);
    const documents = (snapshot.frames ?? []).filter((f) => f !== null).map((f) => f.document);
    const score = Math.max(...documents.map((d) => d.fpMetrics?.score ?? 0), 0);
    // Only scripts rated possible or higher count; many scripts read a detail or two, e.g. the user agent.
    const allScripts = fingerprintingDetails(snapshot);
    const scripts = allScripts.filter((s) => s.likelihood !== 'unlikely');

    let summary = 'No suspicious scripts';
    if (scripts.length > 0) {
        const categories = documents
            .flatMap((d) => d.scripts)
            .filter((s) => (s.fpMetrics?.score ?? 0) >= cutoffs.fingerprinting.possible)
            .flatMap((s) => s.fpMetrics?.distinctFpCategories ?? []);
        const techniques = techniqueWords(categories, rareBitsOf(snapshot));
        const shown = techniques.length <= 3 ? techniques : [...techniques.slice(0, 2), `${techniques.length - 2} other details`];

        const thirdParty = scripts.filter((s) => s.party === 'third').length;
        const who = plural(scripts.length, 'suspicious script') + (thirdParty > 0 ? ` (${thirdParty} third-party)` : '');
        summary = `${who} read ${listWords(shown)}`;
    }

    return {
        id: 'fingerprinting',
        title: 'Fingerprinting',
        explanation:
            'Scripts read details about your browser and device, such as how it draws graphics or processes audio. ' +
            'Combined, these details can recognize you across sites without cookies. ' +
            'The more details a script reads that ordinary sites rarely need, and the more they identify, the more likely it is fingerprinting.',
        likelihood: fpLikelihood(score, cutoffs),
        score,
        summary,
        // Signs of hiding count for every script, also those not rated suspicious.
        signals: pageSignals(allScripts),
        rows: scripts.slice(0, OVERVIEW_ROWS).map((s) => ({
            key: s.key,
            name: s.name,
            path: s.path,
            detail: s.origin,
            title: s.url,
            likelihood: s.likelihood,
            score: s.score,
        })),
        moreRows: Math.max(0, scripts.length - OVERVIEW_ROWS),
    };
}

function cnameCloaking(snapshot: TabSnapshot): Category {
    const aliases = cnameDetails(snapshot);
    const targets = unique(aliases.map((a) => a.targetSite));

    let summary = 'No first-party addresses hiding another company';
    if (targets.length > 0) {
        const shown = targets.length <= 2 ? targets : [targets[0]!, `${targets.length - 1} more`];
        summary = `Site addresses that lead to ${listWords(shown)}`;
    }

    return {
        id: 'cname',
        title: 'CNAME cloaking',
        explanation:
            "A site can route another company's tracker through its own address, such as metrics.example.com, " +
            'using a DNS alias (CNAME). The tracker then looks like part of the site and slips past blockers. ' +
            'Content delivery networks use the same setup, so this is never rated above possible.',
        // Content delivery networks look the same as cloaked trackers, so this is never more than possible.
        likelihood: aliases.length > 0 ? 'possible' : 'unlikely',
        score: null,
        summary,
        signals: [],
        rows: aliases.slice(0, OVERVIEW_ROWS).map((a) => ({
            key: a.host,
            name: a.host,
            path: false,
            detail: `→ ${a.targetSite}`,
            title: [a.host, ...a.via, a.target].join(' → '),
            likelihood: null,
            score: null,
        })),
        moreRows: Math.max(0, aliases.length - OVERVIEW_ROWS),
    };
}

function dnsTracking(snapshot: TabSnapshot): Category {
    const pageSite = getEtld1(hostOf(pageUrl(snapshot)));
    const hosts = dnsDetails(snapshot);
    // Sites using ID-like hostnames, highest-scoring first.
    const sites = unique(hosts.map((h) => getEtld1(h.host) ?? h.host));

    let summary = 'No hostnames that look like tracking IDs';
    if (sites.length === 1 && sites[0] === pageSite) {
        summary = "ID-like hostnames on the site's own domain";
    } else if (sites.length > 0) {
        const shown = sites.length <= 2 ? sites : [sites[0]!, `${sites.length - 1} more`];
        summary = `ID-like hostnames from ${listWords(shown)}`;
    }

    return {
        id: 'dns',
        title: 'DNS tracking',
        explanation:
            'Some hostnames contain a long random-looking part, like a3f9c2e8.tracker.com. ' +
            'That part can be an ID unique to you, sent along with every DNS lookup and request to that host.',
        likelihood: hosts.length === 0 ? 'unlikely' : dnsLikelihood(Math.max(...hosts.map((h) => h.score)), cutoffsOf(snapshot)),
        score: null,
        summary,
        signals: [],
        rows: hosts.slice(0, OVERVIEW_ROWS).map((h) => ({
            key: h.host,
            name: h.host,
            path: false,
            detail: plural(h.requests.length, 'request'),
            title: h.host,
            likelihood: h.likelihood,
            score: h.score,
        })),
        moreRows: Math.max(0, hosts.length - OVERVIEW_ROWS),
    };
}

function fpLikelihood(score: number, cutoffs: ScoringSettings['cutoffs']): Likelihood {
    const { possible, likely } = cutoffs.fingerprinting;
    return score >= likely ? 'likely' : score >= possible ? 'possible' : 'unlikely';
}

/** For a hostname that already scored above the possible cutoff. */
function dnsLikelihood(score: number, cutoffs: ScoringSettings['cutoffs']): Likelihood {
    return score >= cutoffs.hostname.likely ? 'likely' : 'possible';
}

/** API categories as words, those counting most toward the score first (e.g. canvas before screen size). */
function techniqueWords(categories: string[], rare: Record<string, number>): string[] {
    const counts = categoryRareBits(rare);
    const sorted = unique(categories).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
    return unique(sorted.map(fpCategoryName));
}

/** The average rare bits of each kind's APIs (see rareBitsOf), for listing kinds in order. */
function categoryRareBits(rare: Record<string, number>): Record<string, number> {
    const byCategory = Object.groupBy(FP_APIS, (api) => api.category);
    return Object.fromEntries(Object.entries(byCategory).map(([category, apis]) => [category, apis!.reduce((sum, api) => sum + (rare[api.id] ?? 0), 0) / apis!.length]));
}

// ---------- detail screens ----------

export interface ScriptDetail {
    /** Stable across updates: frame plus script URL. */
    key: string;
    /** The URL path, or a description such as "Inline script" when there is none. */
    name: string;
    /** True when the name is a URL path: its file name (from the last "/") always shows. */
    path: boolean;
    /**
     * Who serves the script: the host it really comes from (for a CNAME-cloaked host the server the
     * alias points to, as the alias is a first-party name), or a description such as "Embedded in
     * example.com".
     */
    origin: string;
    /** The full host behind origin, and the alias it went through, for the tooltip. */
    originTitle: string;
    url: string;
    /**
     * What the script viewer needs to show the script: its file, or for an inline script its page.
     * Null when it can't be shown, e.g. for generated scripts or URLs other than http and https.
     */
    viewer: ViewerParams | null;
    /** Whose script it is; null when its source is unknown. A host that is a CNAME alias for another site counts as third party. */
    party: 'first' | 'third' | null;
    /** The server the script's host is a CNAME alias for, if it is cloaked; null otherwise. */
    aliasOf: string | null;
    /** The script's own host if it is such an alias, which origin then goes "through"; null otherwise. */
    via: string | null;
    likelihood: Likelihood;
    score: number;
    /** The signals the score was combined from. */
    tree: ScoreNode[];
    calls: number;
    /** What it learned about the device, by kind of detail, the most identifying kind first. */
    learned: LearnedKind[];
    /** Signs that the script hides what it does; empty if there are none. */
    signals: Signal[];
    /** Fingerprinting APIs with call counts (null if unknown) and call positions, most called first. */
    apis: ViewerApi[];
    /** The fingerprinting APIs it read in detail, for its page: the most identifying first. */
    apiDetails: ApiDetail[];
    /** Requests carrying data that the script made right after fingerprinting, the most data first. */
    sent: SentRequest[];
}

/** A fingerprinting API a script read, with how and when (see apiDetails). */
export interface ApiDetail {
    id: string;
    /** Its kind of detail, e.g. "Graphics card", and what it reveals, e.g. "graphics card name" (see FP_APIS). */
    kind: string;
    reveals: string;
    /** Its bits on their own, the bits it adds beyond an overlapping API, and its rarity, as set (see ApiTraits). */
    bits: number;
    adds: number;
    rarity: number;
    calls: number;
    /** When it was first and last called, in ms since the page started; null if unknown. */
    first: number | null;
    last: number | null;
    /** How many places in the code it was called from, and whether any of them is generated code. */
    places: number;
    generated: boolean;
    /** Whether it was read in the strongest burst, the one its score comes from. */
    inStrongestBurst: boolean;
    /**
     * What it counts toward the score among everything the script (or the page) read: the bits it
     * counted (all of them, what it adds beside an overlapping API, or none for a value another API
     * counted), times its rarity weight (its rarity to the exponent), its rare bits.
     */
    counted: { bits: number; weight: number; rareBits: number; overlapsWith?: string; countedWith?: string };
}

/** A kind of detail a script read, e.g. "Graphics card", with what it learned: "name, rendered 3D image". */
export interface LearnedKind {
    kind: string;
    facts: string[];
}

/** A request with data, as the extension saw it: its contents are unknown, only its size. */
export interface SentRequest {
    method: string;
    /** The site the request really ends on (see realSite). */
    site: string;
    /** The host it went to if that is a CNAME alias for site, which it then went "through"; null otherwise. */
    via: string | null;
    /** The URL's path, e.g. "/b/ss/…". */
    path: string;
    /**
     * How much data it carried, in bytes: its body and its URL's query string, so a POST and a GET
     * are measured alike (a GET carries its data in the query).
     */
    bytes: number;
}

/** Scripts that called fingerprinting APIs, across all frames, most suspicious first. */
export function fingerprintingDetails(snapshot: TabSnapshot): ScriptDetail[] {
    const cutoffs = cutoffsOf(snapshot);
    const traits = traitsOf(snapshot);
    const power = rarityPowerOf(snapshot);
    const rare = rareBitsOf(snapshot);
    const pageSite = getEtld1(hostOf(pageUrl(snapshot)));
    const aliases = cloakedHosts(snapshot);

    return (snapshot.frames ?? [])
        .filter((f) => f !== null)
        .flatMap((frame) =>
            frame.document.scripts
                .filter((s) => (s.fpMetrics?.intensity ?? 0) > 0)
                .map((script): ScriptDetail => {
                    const { name, path, origin, host, linkable, inline } = describeScript(script.name, frame.document.url);
                    const site = realSite(host, aliases);
                    const score = script.fpMetrics?.score ?? 0;
                    const correlations = script.fpSpikes.flatMap((spike) => spike?.httpCorrelations ?? []);
                    const apis = apiList(script.apiCounts, script.apiLocations, script.fpMetrics?.distinctFpApis ?? []);
                    // An inline script is shown from its page, which is the script's URL in stack traces.
                    const viewerSource = linkable || inline ? linkableUrl(script.name) : null;

                    return {
                        key: `${frame.frameId}|${script.name}`,
                        name,
                        path,
                        origin: path && host ? realHost(host, aliases) : origin,
                        originTitle: originTitle(host, aliases) || origin,
                        viewer: viewerSource ? { url: viewerSource, name, apis, inline } : null,
                        url: script.name,
                        party: site === null ? null : site === pageSite ? 'first' : 'third',
                        aliasOf: host ? (aliases.get(host) ?? null) : null,
                        via: host && aliases.has(host) ? host : null,
                        likelihood: fpLikelihood(score, cutoffs),
                        score,
                        tree: scriptTree(script),
                        calls: script.fpMetrics?.intensity ?? 0,
                        learned: learnedKinds(script.fpMetrics?.distinctFpApis ?? [], rare),
                        signals: scriptSignals(script.apiLocations, traits, power, rare),
                        apis,
                        sent: sentRequests(correlations, aliases),
                        apiDetails: apiDetails(script, frame.document.startTime, traits, power),
                    };
                })
        )
        .sort((a, b) => b.score - a.score || b.calls - a.calls);
}

export type SignalId = 'generated-code' | 'one-place';

export interface Signal {
    id: SignalId;
    /**
     * What was observed, as a count of APIs and the words after it: "14" and "read from one place in
     * the code" for "14 APIs read from one place in the code". It follows "Read 14 fingerprinting APIs".
     */
    count: number;
    rest: string;
    /** The APIs it is about, and their kinds of detail, the most identifying first (see learnedKinds). */
    apis: string[];
    kinds: string[];
    /** Why it is a sign of fingerprinting, in a sentence; not shown for now. */
    explanation: string;
}

/** The signals any of the scripts show, for the overview; it only says that they occur, not how often. */
function pageSignals(scripts: ScriptDetail[]): string[] {
    const occurs = (id: SignalId) => scripts.some((s) => s.signals.some((signal) => signal.id === id));

    return [
        occurs('generated-code') ? 'Fingerprinting APIs read from generated code' : '',
        occurs('one-place') ? 'Fingerprinting APIs read from one place in the code' : '',
    ].filter(Boolean);
}

/**
 * Different APIs read from one place in the code from which the popup mentions it. Ordinary scripts
 * read at most 2 there (e.g. { innerWidth, innerHeight } = window); the score counts from 3 on.
 */
const ONE_PLACE_MIN_APIS = 5;

/**
 * Rare bits read through generated code or from one place from which the card mentions it: below,
 * the APIs read that way are everyday ones and add next to nothing to the score (e.g. a template
 * engine reading document.cookie through eval).
 */
const SIGNAL_MIN_RARE_BITS = 1;

/**
 * Signs of fingerprinting in how a script's calls are made, from generated code or many from one
 * place, when they count toward the score: as it does, by the rare bits read that way.
 */
function scriptSignals(apiLocations: Record<string, CallLocation[]> | undefined, traits: Record<string, ApiTraits>, power: number, rare: Record<string, number>): Signal[] {
    const signals: Signal[] = [];
    const kindsOf = (ids: string[]) => learnedKinds(ids, rare).map(({ kind }) => kind);
    const counts = (ids: string[]) => rareIdentifyingBits(ids, traits, power) >= SIGNAL_MIN_RARE_BITS;

    // An API counts as read by generated code as soon as one of its calls was, however many weren't.
    const entries = Object.entries(apiLocations ?? {});
    const generated = entries.filter(([, locations]) => locations.some((l) => l.generated)).map(([id]) => id);
    if (generated.length > 0 && counts(generated)) {
        signals.push({
            id: 'generated-code',
            count: generated.length,
            rest: 'read from generated code',
            apis: generated,
            kinds: kindsOf(generated),
            explanation: 'Code created while the page runs (eval, new Function) is hidden from the script file, which hides what it does.',
        });
    }

    // The place in the code reading the most different APIs: a loop or VM instruction collecting them.
    const byPlace = new Map<string, string[]>();
    for (const [id, locations] of entries) {
        const places = locations.map((l) => placeKey({ line: l.line, column: l.column, generated: l.generated, innerLine: l.inner?.line, innerColumn: l.inner?.column }));
        for (const place of new Set(places)) byPlace.set(place, [...(byPlace.get(place) ?? []), id]);
    }
    const fromOnePlace = [...byPlace.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    if (fromOnePlace.length >= ONE_PLACE_MIN_APIS && counts(fromOnePlace)) {
        signals.push({
            id: 'one-place',
            count: fromOnePlace.length,
            rest: 'read from one place in the code',
            apis: fromOnePlace,
            kinds: kindsOf(fromOnePlace),
            explanation: 'Ordinary code reads each detail where it needs it; collecting them through one loop is typical of fingerprinting.',
        });
    }

    return signals;
}

/**
 * What a script learned from the APIs it read, as the APIs' own words (see FpApi.reveals), grouped by
 * kind. Kinds and the facts in them go from the API counting most toward the score down (its rare
 * bits, see rareBitsOf), so those named first are what makes a script suspicious; APIs revealing
 * the same value share their words, so they show once.
 */
function learnedKinds(apiIds: string[], rare: Record<string, number>): LearnedKind[] {
    const counts = (id: string) => rare[id] ?? 0;
    const apis = apiIds
        .map((id) => FP_APIS_BY_ID[id])
        .filter((api) => api !== undefined)
        .sort((a, b) => counts(b.id) - counts(a.id));
    const byKind = new Map<string, string[]>();
    for (const api of apis) {
        const facts = byKind.get(api.category) ?? [];
        if (!facts.includes(api.reveals)) facts.push(api.reveals);
        byKind.set(api.category, facts);
    }
    // Map keeps the order in which kinds first appear: by their API counting most.
    return [...byKind.entries()].map(([category, facts]) => ({ kind: capitalize(fpCategoryName(category)), facts }));
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The requests with data a script made right after fingerprinting, the most data first; one per URL. */
function sentRequests(correlations: HttpConsolidatedEvent[], aliases: Map<string, string>): SentRequest[] {
    const byUrl = new Map<string, SentRequest>();
    for (const { httpRequest, httpEvent } of correlations) {
        const url = httpRequest?.url ?? httpEvent?.requestUrl;
        if (!url) continue;
        const method = (httpRequest?.method ?? httpEvent?.method ?? 'GET').toUpperCase();
        let query = '';
        try {
            query = new URL(url).search.slice(1);
        } catch {}
        const request: SentRequest = {
            method,
            site: realSite(hostOf(url), aliases) ?? hostOf(url),
            via: aliases.has(hostOf(url)) ? hostOf(url) : null,
            path: urlPath(url),
            bytes: (httpRequest?.bodyBytes ?? 0) + new TextEncoder().encode(query).length,
        };
        const key = `${method} ${url}`;
        if ((byUrl.get(key)?.bytes ?? -1) < request.bytes) byUrl.set(key, request);
    }
    return [...byUrl.values()].sort((a, b) => b.bytes - a.bytes);
}

/** The metrics of the spike with the highest score. */
function strongestSpike(spikes: (SpikeSnapshot | null)[]): MetricsSnapshot | null {
    return (
        spikes
            .map((spike) => spike?.fpMetrics)
            .filter((metrics) => metrics != null)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null
    );
}

// ---------- score trees ----------

/**
 * A part of a score in its tree: a signal, or an API of a signal made from the APIs read. Its share
 * is how much of its parent's value it accounts for, so the shares of a node's children always add
 * up to the node's own value (its ring), down to the APIs.
 */
export interface ScoreNode {
    key: string;
    label: string;
    /**
     * How strongly it was observed, from 0 to 1: a signal's value (1 = full), the score of the
     * script or burst it stands for, or what an API added.
     */
    value: number;
    /** For a signal made from the APIs read: the points it added up and where they count as full. */
    points?: { total: number; fullAt: number };
    /** How much of its parent's value it accounts for, on the same scale (0 to 1). */
    share: number;
    /** The share rounded to hundredths so that siblings add up to their parent's rounded value. */
    shownShare: number;
    /** Whose value the share goes to, in a word or two, e.g. "burst" or "unusual". */
    shareTo: string;
    /** What the node was made from, e.g. the strongest script's name; empty if nothing. */
    detail: string;
    /** True when detail is a script's URL path, shortened keeping its file name (see MiddleTruncate). */
    detailPath?: boolean;
    /** The tooltip: how the share came about. */
    note: string;
    /** An API id, shown in monospace. */
    api?: boolean;
    /**
     * A factor of its parent rather than a part of it: an API's rare bits are its bits times its
     * rarity weight, so they have no share of their own to add up.
     */
    factor?: boolean;
    /** What its ring shows instead of its value on 0–100: an amount of its own, such as an API's rare bits. */
    ringText?: string;
    children: ScoreNode[];
}

/** The page's fingerprinting score and the signals it was combined from. */
export interface PageScore {
    score: number;
    likelihood: Likelihood;
    tree: ScoreNode[];
}

/** The fingerprinting score of the page's most suspicious document (a frame), and its tree. */
export function fingerprintingPage(snapshot: TabSnapshot): PageScore {
    const documents = (snapshot.frames ?? []).filter((f) => f !== null).map((f) => f.document);
    const document = documents.sort((a, b) => (b.fpMetrics?.score ?? 0) - (a.fpMetrics?.score ?? 0))[0];
    const score = document?.fpMetrics?.score ?? 0;
    return { score, likelihood: fpLikelihood(score, cutoffsOf(snapshot)), tree: document ? pageTree(document, score) : [] };
}

/**
 * The page as a whole, shown like a script: its score, and what all its scripts (see
 * fingerprintingDetails) read and sent together. Of the signs, each shows its strongest script's
 * count, as APIs from different scripts don't add up to one place or one piece of generated code.
 */
export function fingerprintingPageDetail(snapshot: TabSnapshot, scripts: ScriptDetail[]): ScriptDetail {
    const page = fingerprintingPage(snapshot);
    const url = pageUrl(snapshot) ?? '';
    // Named by its full host, like the popup's header: "accounts.google.com" is not all of google.com.
    const host = pageHost(snapshot) || 'Whole page';

    const calls = new Map<string, number | null>();
    for (const script of scripts) {
        for (const api of script.apis) {
            const known = calls.get(api.id);
            calls.set(api.id, api.calls === null && !known ? null : (known ?? 0) + (api.calls ?? 0));
        }
    }
    const apis = [...calls.entries()]
        .map(([id, count]) => ({ id, calls: count, positions: [] }))
        .sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0) || a.id.localeCompare(b.id));

    const signals = (['generated-code', 'one-place'] as SignalId[])
        .map((id) =>
            scripts
                .flatMap((script) => script.signals.filter((signal) => signal.id === id))
                .sort((a, b) => b.count - a.count)[0]
        )
        .filter((signal) => signal !== undefined);

    return {
        key: 'page',
        name: host,
        path: false,
        origin: 'All activity',
        originTitle: url,
        url,
        viewer: null,
        party: null,
        aliasOf: null,
        via: null,
        likelihood: page.likelihood,
        score: page.score,
        tree: page.tree,
        calls: scripts.reduce((sum, script) => sum + script.calls, 0),
        learned: learnedKinds(
            apis.map((api) => api.id),
            rareBitsOf(snapshot)
        ),
        signals,
        apis,
        sent: scripts.flatMap((script) => script.sent).sort((a, b) => b.bytes - a.bytes),
        apiDetails: pageApiDetails(snapshot, scripts),
    };
}

/** A script's APIs in detail (see ApiDetail), those counting most first, then the most called. */
function apiDetails(script: ScriptSnapshot, startTime: number | undefined, traits: Record<string, ApiTraits>, power: number): ApiDetail[] {
    const burst = new Set(strongestSpike(script.fpSpikes)?.distinctFpApis ?? []);
    const ids = new Set([...Object.keys(script.apiCounts ?? {}), ...(script.fpMetrics?.distinctFpApis ?? [])]);
    const since = (time: number | undefined) => (time === undefined || startTime === undefined ? null : Math.max(0, time - startTime));
    return sortApiDetails(
        [...ids].map((id): ApiDetail => {
            const api = FP_APIS_BY_ID[id];
            const locations = script.apiLocations?.[id] ?? [];
            const times = script.apiTimes?.[id];
            return {
                id,
                kind: api ? capitalize(fpCategoryName(api.category)) : 'Other',
                reveals: api?.reveals ?? '',
                bits: traits[id]?.bits ?? 0,
                adds: traits[id]?.adds ?? 0,
                rarity: traits[id]?.rarity ?? 0,
                calls: script.apiCounts?.[id] ?? 0,
                first: since(times?.first),
                last: since(times?.last),
                places: locations.length,
                generated: locations.some((location) => location.generated),
                inStrongestBurst: burst.has(id),
                counted: { bits: 0, weight: 0, rareBits: 0 },
            };
        }),
        power
    );
}

/**
 * The page's APIs in detail, all its scripts together: calls and places added up, the earliest
 * first call and latest last call; in the strongest burst means the page's, that of the other scripts beside the strongest one.
 */
function pageApiDetails(snapshot: TabSnapshot, scripts: ScriptDetail[]): ApiDetail[] {
    const documents = (snapshot.frames ?? []).filter((f) => f !== null).map((f) => f.document);
    const pageBurst = documents
        .flatMap((document) => document.spikes ?? [])
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    const burst = new Set(pageBurst?.distinctFpApis ?? []);
    const byId = new Map<string, ApiDetail>();
    for (const detail of scripts.flatMap((script) => script.apiDetails)) {
        const known = byId.get(detail.id);
        if (!known) {
            byId.set(detail.id, { ...detail, inStrongestBurst: burst.has(detail.id) });
            continue;
        }
        known.calls += detail.calls;
        known.places += detail.places;
        known.generated ||= detail.generated;
        known.first = minOf(known.first, detail.first);
        known.last = known.last === null ? detail.last : detail.last === null ? known.last : Math.max(known.last, detail.last);
    }
    // What each counts among all the page's APIs, like the page's own bits.
    return sortApiDetails([...byId.values()], rarityPowerOf(snapshot));
}

/**
 * The identifying information of APIs read, added up in bits like the score does (see apisSums):
 * those revealing the same value once, of overlapping ones the strongest fully and the others what
 * they add. Still an upper bound: what an API adds is measured beside the one API telling the most
 * about it, and APIs of different groups can overlap too.
 */
export function identifyingBits(apis: ApiDetail[]): number {
    return addedUpBits(
        apis.map((api) => api.id),
        Object.fromEntries(apis.map((api) => [api.id, { bits: api.bits, adds: api.adds, rarity: api.rarity }]))
    );
}

function minOf(a: number | null, b: number | null): number | null {
    return a === null ? b : b === null ? a : Math.min(a, b);
}

/**
 * The APIs with what each counts among all of them (see ApiDetail.counted), those counting most
 * first, then those revealing most, then the most called.
 */
function sortApiDetails(details: ApiDetail[], power: number): ApiDetail[] {
    const amounts = rareAmounts(
        details.map((api) => api.id),
        Object.fromEntries(details.map((api) => [api.id, { bits: api.bits, adds: api.adds, rarity: api.rarity }])),
        power
    );
    for (const api of details) {
        const amount = amounts.get(api.id);
        api.counted = {
            bits: amount?.basis ?? 0,
            weight: amount?.weight ?? 0,
            rareBits: amount?.amount ?? 0,
            ...(amount?.overlapsWith ? { overlapsWith: amount.overlapsWith } : {}),
            ...(amount?.countedWith ? { countedWith: amount.countedWith } : {}),
        };
    }
    return details.sort((a, b) => b.counted.rareBits - a.counted.rareBits || b.bits - a.bits || b.calls - a.calls || a.id.localeCompare(b.id));
}

function pageTree(document: DocumentSnapshot, total: number): ScoreNode[] {
    return scoreTree('page', document.fpMetrics, total, (key) => {
        if (key === 'strongestScript') {
            const script = [...document.scripts].sort((a, b) => (b.fpMetrics?.score ?? 0) - (a.fpMetrics?.score ?? 0))[0];
            if (!script) return null;
            const { name, path } = describeScript(script.name, document.url);
            return { detail: name, detailPath: path, children: scriptTree(script) };
        }
        if (key === 'otherScripts') {
            // Made from their own signals, sent along with the page's (see computeDocumentFpScore).
            const other = document.fpMetrics?.signals?.otherScripts;
            if (!other?.parts) return null;
            const metrics = { ...document.fpMetrics!, score: other.value, signals: other.parts };
            const scripts = document.scripts.filter((script) => (script.fpMetrics?.intensity ?? 0) > 0).length - 1;
            return {
                detail: scripts > 0 ? `${plural(scripts, 'script')}, on top of the strongest` : '',
                children: scoreTree('otherScripts', metrics, other.value, (inner) => {
                    if (inner !== 'strongestBurst') return null;
                    // An older background may not send the page's bursts.
                    const burst = [...(document.spikes ?? [])].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0];
                    if (!burst) return null;
                    const detail = `${plural(burst.distinctFpApis.length, 'API')} within ${duration(burst.durationMs)}`;
                    return { detail, children: scoreTree('burst', burst, burst.score ?? 0) };
                }),
            };
        }
        return null;
    });
}

/** A script's signals, sharing its score. */
function scriptTree(script: ScriptSnapshot): ScoreNode[] {
    return scoreTree('script', script.fpMetrics, script.fpMetrics?.score ?? 0, (key) => {
        if (key !== 'strongestBurst') return null;
        const burst = strongestSpike(script.fpSpikes);
        if (!burst) return null;
        const detail = `${plural(burst.distinctFpApis.length, 'API')} within ${duration(burst.durationMs)}`;
        return { detail, children: scoreTree('burst', burst, burst.score ?? 0) };
    });
}

/**
 * The signals of a score, most contributing first (ties in the order the settings list them),
 * sharing `total`, the score. A
 * signal made from another score or from APIs has children sharing its own value in turn, so each
 * level adds up to the ring of its parent. Signals combine as 1 − Π(1 − alone), which
 * isn't a sum, so the total is split as a waterfall: the strongest signal gets what it gives alone,
 * each next one, from strongest to weakest, what it adds on top of those before it. The shares add
 * up to exactly the total. Signals switched off (strength 0) are left out, as they can't contribute.
 * `expand` gives what a signal was made from, for those made from another score.
 */
function scoreTree(
    level: ScoreLevel,
    metrics: MetricsSnapshot | null | undefined,
    total: number,
    expand: (key: string) => { detail: string; detailPath?: boolean; children: ScoreNode[] } | null = () => null
): ScoreNode[] {
    const parts = metrics?.signals ?? {};
    const signals = Object.entries(SIGNALS[level]).flatMap(([key, signal]) => {
        const part = parts[key];
        if (!part || part.strength <= 0) return [];
        return [{ key, signal, part, alone: part.strength * part.value }];
    });

    // What each adds on top of the stronger ones, as a fraction of the score they make together.
    const added = new Map<string, number>();
    let reached = 0;
    for (const { key, alone } of [...signals].sort((a, b) => b.alone - a.alone)) {
        added.set(key, (1 - reached) * alone);
        reached += (1 - reached) * alone;
    }

    const nodes = signals.map(({ key, signal, part, alone }): ScoreNode => {
        const share = reached > 0 ? total * (added.get(key)! / reached) : 0;
        const source: { detail: string; detailPath?: boolean; children: ScoreNode[] } | null =
            part.value <= 0 ? null : part.apis ? apisSource(part.apis, part.value, SHORT_NAMES[key] ?? signal.label, level) : (expand(key) ?? partsSource(level, key, part, expand));
        return {
            key,
            label: treeLabel(signal.label),
            value: part.value,
            // Beyond what is already counted, the points are those that count: what was still missing.
            points: part.apis ? { total: part.apis.known === undefined ? part.apis.total : part.value * part.apis.fullAt, fullAt: part.apis.fullAt } : undefined,
            share,
            shownShare: share,
            shareTo: SHARE_TO[level] ?? level,
            detail: source?.detail ?? '',
            detailPath: source?.detailPath,
            note: `Accounts for ${score(share)} of the ${score(total)} above: what it adds on top of the stronger signals. Alone it would give ${score(alone)}: up to ${Math.round(part.strength * 100)}% × ${score(part.value)}% observed.`,
            children: source?.children ?? [],
        };
    });
    // Most contributing first, reading like the waterfall; sort keeps ties in the settings' order.
    return withShownShares(nodes, total).sort((a, b) => b.share - a.share);
}

/**
 * Rounds the shares of siblings to hundredths so that they add up to their parent's rounded value
 * (largest remainder): rounded one by one, 0.985 and 0.005 would show as 0.98 and 0.00 under 0.99.
 * A share never shows above the node's own rounded ring when it isn't above it (a strongest script
 * giving its whole 0.364 shows +36 under a ring of 36, not +37); others take the hundredth then.
 */
function withShownShares(nodes: ScoreNode[], total: number): ScoreNode[] {
    const cents = nodes.map((node) => node.share * 100);
    const shown = cents.map(Math.floor);
    const ceiling = nodes.map((node) => (node.share <= node.value ? Math.round(node.value * 100) : Infinity));
    let missing = Math.round(total * 100) - shown.reduce((sum, x) => sum + x, 0);
    // The largest remainders get the missing hundredths: first those staying within their ring,
    // then, if some are still missing, any.
    const byRemainder = cents.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest);
    for (const capped of [true, false]) {
        for (const { i } of byRemainder) {
            if (missing <= 0) break;
            if (capped && shown[i]! + 1 > ceiling[i]!) continue;
            shown[i]! += 1;
            missing -= 1;
        }
    }
    return nodes.map((node, i) => ({ ...node, shownShare: shown[i]! / 100 }));
}

// Short names of the signals made from APIs, for "+0.10 to unusual" under an API's share.
/** A score, share or signal value from 0 to 1 as shown, on the 0–100 scale of the score rings: 0.94 as 94. */
function score(x: number): number {
    return Math.round(x * 100);
}

/**
 * A signal's name in the score tree: "fingerprinting" left out before APIs ("Identifying APIs", "Unusual APIs", "APIs
 * from one place"), as the tree is for those who look closer and has little room.
 */
function treeLabel(label: string): string {
    return capitalize(label.replace(/fingerprinting APIs/i, 'APIs'));
}

const SHORT_NAMES: Record<string, string> = {
    rareIdentifying: 'rare identifying',
    onePlace: 'one place',
    generatedCode: 'generated',
};

/**
 * The APIs an API signal was made from, sharing the signal's value like signals share a score: as a
 * waterfall, from the API adding the most down, each adding its points relative to the full-at
 * (1 of 10 points is +0.10) until the signal is full; later ones add nothing beyond full. An API
 * whose information another API already counted adds nothing.
 */
/** Whose score a signal's share goes to, in a word or two: "+6 to other scripts". */
const SHARE_TO: Partial<Record<ScoreLevel, string>> = { otherScripts: 'other scripts', otherScriptsBeyondBurst: 'outside burst', scriptBeyondBurst: 'outside burst' };

/**
 * A signal that is the score of a part made from its own signals (see SignalPart.parts), such as
 * what a script read outside its burst: opens into those, which `expand` can open further.
 */
function partsSource(
    level: ScoreLevel,
    key: string,
    part: SignalPart,
    expand: (key: string) => { detail: string; detailPath?: boolean; children: ScoreNode[] } | null
): { detail: string; children: ScoreNode[] } | null {
    const source = (SIGNAL_SOURCES[level] as Record<string, string> | undefined)?.[key];
    if (!part.parts || !source || source === 'apis' || !(source in SIGNALS)) return null;
    return { detail: '', children: scoreTree(source as ScoreLevel, { signals: part.parts } as MetricsSnapshot, part.value, expand) };
}

/** An amount in a ring: one decimal, two below 1 ("0.07"), without trailing zeros. */
function amount(x: number): string {
    return String(+x.toFixed(x < 1 ? 2 : 1));
}

/**
 * What an API's rare bits are made of, as rows under it: its bits (on its own, or what it adds beside
 * an overlapping API) on the signal's scale, and its rarity weight. Their rings multiply to its own.
 */
function rareFactors(api: ApiAmount, fullAt: number, number: (x: number) => number): ScoreNode[] {
    const own = api.bits ?? api.basis;
    const rarity = api.rarity ?? 0;
    const weight = api.weight ?? 0;
    const share = Math.round((1 - rarity) * 100);
    const bits = api.countedWith
        ? `${number(own)} on its own, the same information as ${api.countedWith}: counts none`
        : api.overlapsWith
          ? `adds ${number(api.basis)} beside ${api.overlapsWith}, ${number(own)} on its own`
          : `${number(own)}, what it tells browsers apart by on average`;
    const factor = (key: string, label: string, value: number, ringText: string, detail: string, note: string): ScoreNode => ({
        key: `${api.id}:${key}`,
        label,
        value,
        ringText,
        share: 0,
        shownShare: 0,
        shareTo: api.id,
        detail,
        note,
        factor: true,
        children: [],
    });
    return [
        factor('bits', 'Bits', fullAt > 0 ? api.basis / fullAt : 0, amount(api.basis), bits, `${number(api.basis)} bits counted, of the ${number(fullAt)} that would make the signal full if all of them counted.`),
        factor(
            'rarity',
            'Rarity',
            weight,
            weight.toFixed(2),
            `${number(rarity)}, ${share < 1 ? 'under 1%' : `${share}%`} of page loads read it`,
            `Rarity ${number(rarity)} to the fourth power: ${number(weight)}, the share of its bits that counts.`
        ),
    ];
}

/** Where the APIs a sum beyond is measured on were read (see apisSumsBeyond). */
// Only page bursts are measured on top of something among bursts: the strongest script.
const KNOWN_WHERE: Partial<Record<ScoreLevel, string>> = {
    scriptBeyondBurst: 'read in the strongest burst',
    otherScriptsBeyondBurst: 'read by the strongest script or in the burst',
    burst: 'read by the strongest script',
};

function apisSource(sum: ApisSum, total: number, signal: string, signalLevel: ScoreLevel): { detail: string; children: ScoreNode[] } {
    const number = (x: number) => +x.toFixed(2);
    // What the sum counts: bits of identifying information, or rare ones (bits times rarity).
    const unit = sum.measure === 'rareBits' ? 'rare bits' : 'bits';
    // An API's own value: "5.9 bits"; for rare bits, the bits it counted.
    const own = (basis: number) => `${number(basis)} bits`;

    // sum.apis is sorted by what they add, most first.
    const shares = new Map<string, number>();
    let reached = 0;
    for (const api of sum.apis) {
        const add = sum.fullAt > 0 ? Math.min(api.amount / sum.fullAt, Math.max(0, total - reached)) : 0;
        shares.set(api.id, add);
        reached += add;
    }

    const children = sum.apis.map((api): ScoreNode => {
        const share = shares.get(api.id) ?? 0;
        const adds =
            sum.measure === 'rareBits'
                ? `${own(api.basis)}${api.overlapsWith ? ` beside ${api.overlapsWith}` : ''} × ${number(api.weight ?? 0)}`
                : api.overlapsWith
                  ? `${own(api.basis)}, adds ${number(api.amount)} beside ${api.overlapsWith}`
                  : own(api.basis);
        let note = `Adds ${number(api.amount)} of the ${number(sum.fullAt)} ${unit} that make it full: +${score(share)}.`;
        // A sum beyond what is already counted names that as such: "read in the burst".
        const where = api.withKnown ? `, ${KNOWN_WHERE[signalLevel]}` : '';
        if (api.countedWith) note = `Same information as ${api.countedWith}${where}, which counts instead.`;
        else if (api.overlapsWith && sum.measure === 'rareBits')
            note = `Overlaps with ${api.overlapsWith}${where}: counts only the ${number(api.basis)} bits it tells beyond it, times its rarity: ${number(api.amount)} rare bits, +${score(share)}.`;
        else if (api.overlapsWith)
            note = `Overlaps with ${api.overlapsWith}${where}, which counts all its bits: this one adds only the ${number(api.amount)} bits it tells beyond it, +${score(share)}.`;
        else if (api.amount > 0 && share < api.amount / sum.fullAt - 0.005)
            note = `Adds ${number(api.amount)} ${unit}, but the APIs adding more already filled it up to full: +${score(share)}.`;
        return {
            key: api.id,
            label: api.id,
            api: true,
            // Its own value in the signal: its rare bits, the ring filled toward full.
            value: sum.fullAt > 0 ? api.amount / sum.fullAt : 0,
            ringText: sum.measure === 'rareBits' ? amount(api.amount) : undefined,
            share,
            shownShare: share,
            shareTo: signal,
            detail: api.countedWith ? `counted with ${api.countedWith}` : adds,

            note,
            children: sum.measure === 'rareBits' ? rareFactors(api, sum.fullAt, number) : [],
        };
    });
    // Beyond what is already counted: "9 bits on top of 31, 2 of them toward 33".
    const detail =
        sum.known !== undefined
            ? `${number(sum.total)} ${unit} on top of ${number(sum.known)}, ${number(total * sum.fullAt)} of them toward ${number(sum.fullAt)}`
            : `${number(sum.total)} of ${number(sum.fullAt)} ${unit} from ${plural(sum.apis.length, 'API')}`;
    return { detail, children: withShownShares(children, total) };
}

export interface RequestLine {
    method: string;
    path: string;
}

export interface CnameDetail {
    host: string;
    /** The final CNAME target and its site. */
    target: string;
    targetSite: string;
    /** CNAMEs between the host and the final target. */
    via: string[];
    requests: RequestLine[];
}

/** First-party-looking hosts whose DNS points to another site. */
export function cnameDetails(snapshot: TabSnapshot): CnameDetail[] {
    const byHost = new Map<string, CnameDetail>();
    for (const req of snapshot.cNameRequests ?? []) {
        const host = req.hostname ?? hostOf(req.url);
        const targets = (req.cRecords ?? []).map((r) => r.target);
        const target = targets[targets.length - 1];
        if (!host || !target) continue;

        let detail = byHost.get(host);
        if (!detail) {
            detail = { host, target, targetSite: getEtld1(target) ?? target, via: targets.slice(0, -1), requests: [] };
            byHost.set(host, detail);
        }
        detail.requests.push(requestLine(req.method, req.url));
    }
    return [...byHost.values()].sort((a, b) => b.requests.length - a.requests.length);
}

export interface HostnameDetail {
    host: string;
    likelihood: Likelihood;
    score: number;
    requests: RequestLine[];
}

/** Hostnames that look like they carry an ID, most suspicious first. */
export function dnsDetails(snapshot: TabSnapshot): HostnameDetail[] {
    const cutoffs = cutoffsOf(snapshot);
    const byHost = new Map<string, HostnameDetail>();
    for (const req of snapshot.dnsTrackingRequests ?? []) {
        const score = req.subdomainScore ?? 0;
        const host = req.hostname ?? hostOf(req.url);
        if (score < cutoffs.hostname.possible || !host) continue;

        const detail = byHost.get(host) ?? { host, likelihood: dnsLikelihood(score, cutoffs), score, requests: [] };
        detail.score = Math.max(detail.score, score);
        detail.likelihood = dnsLikelihood(detail.score, cutoffs);
        detail.requests.push(requestLine(req.method, req.url));
        byHost.set(host, detail);
    }
    return [...byHost.values()].sort((a, b) => b.score - a.score);
}

/**
 * APIs with call counts and call positions, most called first. Falls back to the distinct APIs
 * without counts or positions when the snapshot has none, e.g. from a background started before
 * they were added.
 */
function apiList(
    apiCounts: Record<string, number> | undefined,
    apiLocations: Record<string, CallLocation[]> | undefined,
    distinctApis: string[]
): ViewerApi[] {
    const counted = Object.entries(apiCounts ?? {});
    if (counted.length === 0) {
        return [...distinctApis].sort().map((id) => ({ id, calls: null, positions: [] }));
    }
    return counted
        .map(([id, calls]) => ({ id, calls, positions: (apiLocations?.[id] ?? []).map(({ line, column }) => ({ line, column })) }))
        .sort((a, b) => b.calls - a.calls || a.id.localeCompare(b.id));
}

function requestLine(method: string, url: string): RequestLine {
    try {
        const u = new URL(url);
        return { method, path: u.pathname + u.search };
    } catch {
        return { method, path: url };
    }
}

/**
 * How to present a script recorded under `url`: the fp-recorder stores the caller's URL from the
 * stack trace, which is "null" when unknown, the document URL for inline code, or a blob:/data: URL
 * for code generated at runtime. `host` is the host the script belongs to, if any; `linkable` is
 * true for script files, `inline` for code inline in the page.
 */
function describeScript(
    url: string,
    documentUrl: string | null
): { name: string; path: boolean; origin: string; host: string | null; linkable: boolean; inline: boolean } {
    if (url === 'null') {
        return { name: 'Unknown script', path: false, origin: 'Its source could not be determined', host: null, linkable: false, inline: false };
    }

    if (documentUrl && url === documentUrl) {
        const host = hostOf(url);
        return { name: 'Inline script', path: false, origin: `Embedded in ${host}`, host, linkable: false, inline: true };
    }

    if (/^(blob|data):/i.test(url)) {
        // A blob: URL keeps the origin of the page that created it; a data: URL has none.
        let creator = '';
        try {
            creator = hostOf(new URL(url).origin);
        } catch {}
        const origin = creator ? `Created at runtime by ${creator}` : 'Created at runtime';
        return { name: 'Generated script', path: false, origin, host: creator || null, linkable: false, inline: false };
    }

    const host = hostOf(url);
    return {
        name: urlPath(url),
        path: true,
        origin: host,
        host: host || null,
        linkable: true,
        inline: false,
    };
}

/** The URL if it uses http or https. Script URLs come from page stack traces, so other schemes are not linked. */
function linkableUrl(url: string): string | null {
    try {
        const { protocol } = new URL(url);
        return protocol === 'http:' || protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

/** The URL's path, e.g. "/libs/launch-ENdd5c82….min.js"; its last segment is the file name. */
function urlPath(url: string): string {
    return `/${pathSegments(url).join('/')}`;
}

function pathSegments(url: string): string[] {
    try {
        return new URL(url).pathname.split('/').filter(Boolean);
    } catch {
        return [];
    }
}

/** Hosts on the page that are CNAME-cloaked, each with the host it is really an alias for. */
function cloakedHosts(snapshot: TabSnapshot): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const req of snapshot.cNameRequests ?? []) {
        const host = req.hostname ?? hostOf(req.url);
        const target = req.cRecords?.[req.cRecords.length - 1]?.target;
        if (host && target && !aliases.has(host)) aliases.set(host, target);
    }
    return aliases;
}

/** The host a script came from, and the server it is an alias (CNAME) for if it is cloaked. */
function originTitle(host: string | null, aliases: Map<string, string>): string {
    if (!host) return '';
    const target = aliases.get(host);
    return target ? `${host}, an alias (CNAME) for ${target}` : host;
}

/** The host a script really comes from: for a CNAME-cloaked host the server it points to, otherwise itself. */
function realHost(host: string, aliases: Map<string, string>): string {
    return (aliases.get(host) ?? host).replace(/\.$/, '');
}

/**
 * The site a host really belongs to: for a CNAME-cloaked host the site of the server it points to,
 * since a first-party name doesn't tell who serves it; otherwise the host's own site.
 */
function realSite(host: string | null, aliases: Map<string, string>): string | null {
    if (!host) return null;
    return getEtld1(aliases.get(host) ?? host);
}

function hostOf(url: string | null | undefined): string {
    try {
        return new URL(url ?? '').hostname;
    } catch {
        return '';
    }
}

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}

