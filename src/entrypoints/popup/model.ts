// Reduces a TabSnapshot to the three tracking categories the popup shows, each with a likelihood,
// key numbers and the strongest evidence.
import { FP_CATEGORY_ENTROPY, fpCategoryName } from '@/lib/fp-apis';
import { getEtld1 } from '@/lib/http-utils';
import { DEFAULT_SETTINGS, SIGNALS, type ApisSum, type ScoreLevel, type ScoringSettings } from '@/lib/scoring';
import type { ViewerApi, ViewerParams } from '@/lib/script-viewer';
import type { CallLocation, DocumentSnapshot, MetricsSnapshot, ScriptSnapshot, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';
import { duration, plural } from './format';

export type Likelihood = 'unlikely' | 'possible' | 'likely';

export const LIKELIHOOD_LABELS: Record<Likelihood, string> = {
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
        const techniques = techniqueWords(categories);
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

/** API categories as words, most identifying first (e.g. canvas before screen size). */
function techniqueWords(categories: string[]): string[] {
    const sorted = unique(categories).sort((a, b) => (FP_CATEGORY_ENTROPY[b] ?? 0) - (FP_CATEGORY_ENTROPY[a] ?? 0));
    return unique(sorted.map(fpCategoryName));
}

// ---------- detail screens ----------

export interface ScriptDetail {
    /** Stable across updates: frame plus script URL. */
    key: string;
    /** The file name if it is readable, otherwise a description such as "Unnamed script". */
    name: string;
    /** Where the script came from, e.g. its host or "embedded in the page". */
    origin: string;
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
    likelihood: Likelihood;
    score: number;
    /** The signals the score was combined from. */
    tree: ScoreNode[];
    calls: number;
    techniques: string[];
    /**
     * The script's strongest burst of calls: how many different APIs it read and how quickly. Null
     * without one reading at least a few APIs.
     */
    burst: { apis: number; durationMs: number } | null;
    /** Signs that the script hides what it does; empty if there are none. */
    signals: Signal[];
    /** Fingerprinting APIs with call counts (null if unknown) and call positions, most called first. */
    apis: ViewerApi[];
    /** Sites the script made requests to right after fingerprinting (contents unknown), with hosts per site, most hosts first. */
    contacted: { site: string; hosts: string[] }[];
}

/** Scripts that called fingerprinting APIs, across all frames, most suspicious first. */
export function fingerprintingDetails(snapshot: TabSnapshot): ScriptDetail[] {
    const cutoffs = cutoffsOf(snapshot);
    const pageSite = getEtld1(hostOf(pageUrl(snapshot)));
    const aliases = cloakedHosts(snapshot);

    return (snapshot.frames ?? [])
        .filter((f) => f !== null)
        .flatMap((frame) =>
            frame.document.scripts
                .filter((s) => (s.fpMetrics?.intensity ?? 0) > 0)
                .map((script): ScriptDetail => {
                    const { name, origin, host, linkable, inline } = describeScript(script.name, frame.document.url);
                    const site = realSite(host, aliases);
                    const score = script.fpMetrics?.score ?? 0;
                    const correlations = script.fpSpikes.flatMap((spike) => spike?.httpCorrelations ?? []);
                    const apis = apiList(script.apiCounts, script.apiLocations, script.fpMetrics?.distinctFpApis ?? []);
                    // An inline script is shown from its page, which is the script's URL in stack traces.
                    const viewerSource = linkable || inline ? linkableUrl(script.name) : null;

                    return {
                        key: `${frame.frameId}|${script.name}`,
                        name,
                        origin,
                        viewer: viewerSource ? { url: viewerSource, name, apis, inline } : null,
                        url: script.name,
                        party: site === null ? null : site === pageSite ? 'first' : 'third',
                        aliasOf: host ? (aliases.get(host) ?? null) : null,
                        likelihood: fpLikelihood(score, cutoffs),
                        score,
                        tree: scriptTree(script),
                        calls: script.fpMetrics?.intensity ?? 0,
                        techniques: techniqueWords(script.fpMetrics?.distinctFpCategories ?? []),
                        burst: strongestBurst(script.fpSpikes),
                        signals: scriptSignals(script.apiLocations),
                        apis,
                        contacted: groupBySite(correlations.map((c) => hostOf(c.httpRequest?.url ?? c.httpEvent?.requestUrl))),
                    };
                })
        )
        .sort((a, b) => b.score - a.score || b.calls - a.calls);
}

/** Bursts reading fewer different APIs aren't worth mentioning. */
const MIN_BURST_APIS = 3;

export type SignalId = 'generated-code' | 'one-place';

export interface Signal {
    id: SignalId;
    /** What was observed, e.g. "14 of 14 fingerprinting APIs read by code generated at runtime". */
    text: string;
}

/** The signals any of the scripts show, for the overview; it only says that they occur, not how often. */
function pageSignals(scripts: ScriptDetail[]): string[] {
    const occurs = (id: SignalId) => scripts.some((s) => s.signals.some((signal) => signal.id === id));

    return [
        occurs('generated-code') ? 'Fingerprinting APIs read by code generated at runtime' : '',
        occurs('one-place') ? 'Fingerprinting APIs read from one place in the code' : '',
    ].filter(Boolean);
}

/**
 * Different APIs read from one place in the code from which the popup mentions it. Ordinary scripts
 * read at most 2 there (e.g. { innerWidth, innerHeight } = window); the score counts from 3 on.
 */
const ONE_PLACE_MIN_APIS = 5;

/** Signs of fingerprinting in how a script's calls are made: from generated code, or many from one place. */
function scriptSignals(apiLocations: Record<string, CallLocation[]> | undefined): Signal[] {
    const signals: Signal[] = [];

    // An API counts as read by generated code as soon as one of its calls was, however many weren't.
    const apis = Object.values(apiLocations ?? {});
    const generated = apis.filter((locations) => locations.some((l) => l.generated)).length;
    if (generated > 0) {
        signals.push({
            id: 'generated-code',
            text: `${generated} of ${plural(apis.length, 'fingerprinting API')} read by code generated at runtime`,
        });
    }

    // The place in the code reading the most different APIs: a loop or VM instruction collecting them.
    const byPlace = new Map<string, number>();
    for (const locations of apis) {
        for (const place of new Set(locations.map((l) => `${l.line}:${l.column}`))) byPlace.set(place, (byPlace.get(place) ?? 0) + 1);
    }
    const fromOnePlace = Math.max(0, ...byPlace.values());
    if (fromOnePlace >= ONE_PLACE_MIN_APIS) {
        signals.push({
            id: 'one-place',
            text: `${fromOnePlace} of ${plural(apis.length, 'fingerprinting API')} read from one place in the code`,
        });
    }

    return signals;
}

/** The spike with the highest score, as different APIs read and its duration. */
function strongestBurst(spikes: (SpikeSnapshot | null)[]): ScriptDetail['burst'] {
    const strongest = strongestSpike(spikes);
    if (!strongest || strongest.distinctFpApis.length < MIN_BURST_APIS) return null;
    return { apis: strongest.distinctFpApis.length, durationMs: strongest.durationMs };
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
    /** The tooltip: how the share came about. */
    note: string;
    /** An API id, shown in monospace. */
    api?: boolean;
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

function pageTree(document: DocumentSnapshot, total: number): ScoreNode[] {
    return scoreTree('page', document.fpMetrics, total, (key) => {
        if (key === 'strongestScript') {
            const script = [...document.scripts].sort((a, b) => (b.fpMetrics?.score ?? 0) - (a.fpMetrics?.score ?? 0))[0];
            return script ? { detail: describeScript(script.name, document.url).name, children: scriptTree(script) } : null;
        }
        if (key === 'strongestBurst') {
            // An older background may not send the page's bursts.
            const burst = [...(document.spikes ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
            if (!burst) return null;
            const detail = `${plural(burst.distinctFpApis.length, 'fingerprinting API')} within ${duration(burst.durationMs)}, all scripts together`;
            return { detail, children: scoreTree('burst', burst, burst.score ?? 0) };
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
        const detail = `${plural(burst.distinctFpApis.length, 'fingerprinting API')} within ${duration(burst.durationMs)}`;
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
    expand: (key: string) => { detail: string; children: ScoreNode[] } | null = () => null
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
        const source = part.value <= 0 ? null : part.apis ? apisSource(part.apis, part.value, SHORT_NAMES[key] ?? signal.label) : expand(key);
        return {
            key,
            label: signal.label,
            value: part.value,
            points: part.apis ? { total: part.apis.total, fullAt: part.apis.fullAt } : undefined,
            share,
            shownShare: share,
            shareTo: level,
            detail: source?.detail ?? '',
            note: `Accounts for ${share.toFixed(2)} of the ${total.toFixed(2)} above: what it adds on top of the stronger signals. Alone it would give ${alone.toFixed(2)}: up to ${Math.round(part.strength * 100)}% × ${part.value.toFixed(2)} observed.`,
            children: source?.children ?? [],
        };
    });
    // Most contributing first, reading like the waterfall; sort keeps ties in the settings' order.
    return withShownShares(nodes, total).sort((a, b) => b.share - a.share);
}

/**
 * Rounds the shares of siblings to hundredths so that they add up to their parent's rounded value
 * (largest remainder): rounded one by one, 0.985 and 0.005 would show as 0.98 and 0.00 under 0.99.
 */
function withShownShares(nodes: ScoreNode[], total: number): ScoreNode[] {
    const cents = nodes.map((node) => node.share * 100);
    const shown = cents.map(Math.floor);
    let missing = Math.round(total * 100) - shown.reduce((sum, x) => sum + x, 0);
    // The largest remainders get the missing hundredths.
    const byRemainder = cents.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest);
    for (const { i } of byRemainder) {
        if (missing <= 0) break;
        shown[i]! += 1;
        missing -= 1;
    }
    return nodes.map((node, i) => ({ ...node, shownShare: shown[i]! / 100 }));
}

// Short names of the signals made from APIs, for "+0.10 to unusual" under an API's share.
const SHORT_NAMES: Record<string, string> = {
    identifying: 'identifying',
    unusualApis: 'unusual',
    onePlace: 'one place',
    generatedCode: 'generated',
};

/**
 * The APIs an API signal was made from, sharing the signal's value like signals share a score: as a
 * waterfall, from the API adding the most down, each adding its points relative to the full-at
 * (1 of 10 points is +0.10) until the signal is full; later ones add nothing beyond full. An API
 * whose information another API already counted adds nothing.
 */
function apisSource(sum: ApisSum, total: number, signal: string): { detail: string; children: ScoreNode[] } {
    const measure = sum.measure === 'entropy' ? 'entropy' : 'rarity';
    const number = (x: number) => +x.toFixed(2);

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
            sum.measure === 'rarity' && api.amount !== api.basis ? `${measure} ${number(api.basis)}, counts ${number(api.amount)}` : `${measure} ${number(api.basis)}`;
        let note = `Adds ${number(api.amount)} of the ${number(sum.fullAt)} points that make it full: +${share.toFixed(2)}.`;
        if (api.countedWith) note = `Same information as ${api.countedWith}, which counts instead.`;
        else if (api.amount > 0 && share < api.amount / sum.fullAt - 0.005)
            note = `Adds ${number(api.amount)} points, but the APIs adding more already filled it up to full: +${share.toFixed(2)}.`;
        return {
            key: api.id,
            label: api.id,
            api: true,
            value: api.amount,
            share,
            shownShare: share,
            shareTo: signal,
            detail: api.countedWith ? `counted with ${api.countedWith}` : adds,
            note,
            children: [],
        };
    });
    return { detail: `${number(sum.total)} of ${number(sum.fullAt)} from ${plural(sum.apis.length, 'fingerprinting API')}`, children: withShownShares(children, total) };
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

/** Groups hosts by site, e.g. many googlevideo.com servers under one entry; sites with the most hosts first. */
function groupBySite(hosts: string[]): { site: string; hosts: string[] }[] {
    const bySite = new Map<string, string[]>();
    for (const host of unique(hosts.filter(Boolean))) {
        const site = getEtld1(host) ?? host;
        bySite.set(site, [...(bySite.get(site) ?? []), host]);
    }
    return [...bySite.entries()]
        .map(([site, siteHosts]) => ({ site, hosts: siteHosts.sort() }))
        .sort((a, b) => b.hosts.length - a.hosts.length);
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
): { name: string; origin: string; host: string | null; linkable: boolean; inline: boolean } {
    if (url === 'null') {
        return { name: 'Unknown script', origin: 'Its source could not be determined', host: null, linkable: false, inline: false };
    }

    if (documentUrl && url === documentUrl) {
        const host = hostOf(url);
        return { name: 'Inline script', origin: `Embedded in ${host}`, host, linkable: false, inline: true };
    }

    if (/^(blob|data):/i.test(url)) {
        // A blob: URL keeps the origin of the page that created it; a data: URL has none.
        let creator = '';
        try {
            creator = hostOf(new URL(url).origin);
        } catch {}
        const origin = creator ? `Created at runtime by ${creator}` : 'Created at runtime';
        return { name: 'Generated script', origin, host: creator || null, linkable: false, inline: false };
    }

    const host = hostOf(url);
    return {
        name: readableFileName(url) ?? urlPath(url),
        origin: host,
        host: host || null,
        linkable: true,
        inline: false,
    };
}

/**
 * The script's file name as it is, if it has a real word in it: `launch-ENdd5c82….min.js` or
 * `f4c2e99c…_complete.js`, ignoring their hashes and IDs. Names without one, such as `KTUB2JkY` or
 * `1.js`, give null; some scripts use those deliberately to avoid being recognized.
 */
function readableFileName(url: string): string | null {
    const segment = pathSegments(url).pop();
    if (!segment) return null;

    const extension = segment.match(/(\.min)?\.(m|c)?js$/i)?.[0] ?? '';
    const base = segment.slice(0, segment.length - extension.length);

    if (!extension) {
        // Without a .js extension, only word-like names count (e.g. "boomerang", not "KTUB2JkY").
        const parts = base.split(/[-_.]/).filter(Boolean);
        const wordLike = parts.length > 0 && parts.every((part) => /^[a-z]+$/i.test(part) && part.length >= 3 && vowelShare(part) >= 0.25);
        return wordLike ? segment : null;
    }

    const words = base.split(/[^a-z0-9]+/i).filter((token) => !isRandomToken(token));
    const hasWord = words.some((token) => token.replace(/[^a-z]/gi, '').length >= 3);
    return hasWord ? segment : null;
}

/** Long runs that are mostly digits or have hardly any vowels, such as hashes, IDs and timestamps. */
function isRandomToken(part: string): boolean {
    if (part.length < 10) return false;
    const digits = part.replace(/\D/g, '').length;
    return digits >= 4 || vowelShare(part) < 0.2;
}

function vowelShare(text: string): number {
    const letters = text.replace(/[^a-z]/gi, '');
    return letters.length === 0 ? 0 : letters.replace(/[^aeiou]/gi, '').length / letters.length;
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

/**
 * The URL's path, for scripts without a readable name, e.g. `/0RoDdc4z/Tb8rr/9a0Fq`. Such random
 * paths are typical for bot protection served from the site itself, which avoids names that
 * blocklists could match.
 */
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

function listWords(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
