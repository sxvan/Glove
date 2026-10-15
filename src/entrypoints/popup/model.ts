// Reduces a TabSnapshot to the three tracking categories the popup shows, each with a likelihood,
// key numbers and the strongest evidence.
import { FP_CATEGORY_WEIGHTS, fpCategoryName } from '@/lib/fp-apis';
import { getEtld1 } from '@/lib/http-utils';
import type { ViewerApi, ViewerParams } from '@/lib/script-viewer';
import type { CallLocation, SpikeSnapshot, TabSnapshot } from '@/types/snapshot';
import { plural } from './format';

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

// Same cut-offs the analysis uses for its medium/high scores.
const FP_POSSIBLE = 0.4;
const FP_LIKELY = 0.7;
const DNS_POSSIBLE = 0.2;
const DNS_LIKELY = 0.6;

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
    const pageSite = getEtld1(hostOf(pageUrl(snapshot)));
    const scripts = (snapshot.frames ?? []).filter((f) => f !== null).flatMap((f) => f.document.scripts);

    // A domain counts only with real evidence: a script that fingerprints at "possible" or above,
    // being the real target of a cloaked first-party address, or using ID-like hostnames.
    const aliases = cloakedHosts(snapshot);
    const fingerprinters = scripts.filter((s) => (s.fpMetrics?.score ?? 0) >= FP_POSSIBLE).map((s) => realSite(hostOf(s.name), aliases));
    const cloaked = [...aliases.values()].map((target) => getEtld1(target) ?? target);
    const idHosts = unique(
        (snapshot.dnsTrackingRequests ?? []).filter((r) => (r.subdomainScore ?? 0) > DNS_POSSIBLE).map((r) => r.hostname ?? hostOf(r.url))
    );

    const parties = unique([...fingerprinters, ...cloaked, ...idHosts.map((h) => getEtld1(h))].filter((s): s is string => !!s && s !== pageSite));
    const siteFingerprints = fingerprinters.some((s) => s === pageSite);

    let headline = 'No signs of tracking so far';
    if (parties.length > 0) headline = `${plural(parties.length, 'third party', 'third parties')} may be tracking you`;
    else if (siteFingerprints) headline = 'The site itself may be fingerprinting you';

    return { headline, parties };
}

function fingerprinting(snapshot: TabSnapshot): Category {
    const documents = (snapshot.frames ?? []).filter((f) => f !== null).map((f) => f.document);
    const score = Math.max(...documents.map((d) => d.fpMetrics?.score ?? 0), 0);
    // Only scripts rated possible or higher count; many scripts read a detail or two, e.g. the user agent.
    const allScripts = fingerprintingDetails(snapshot);
    const scripts = allScripts.filter((s) => s.likelihood !== 'unlikely');

    let summary = 'No suspicious scripts';
    if (scripts.length > 0) {
        const categories = documents
            .flatMap((d) => d.scripts)
            .filter((s) => (s.fpMetrics?.score ?? 0) >= FP_POSSIBLE)
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
            'The more different details a script reads in a short time, the more likely it is fingerprinting.',
        likelihood: fpLikelihood(score),
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
        likelihood: hosts.length === 0 ? 'unlikely' : dnsLikelihood(Math.max(...hosts.map((h) => h.score))),
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

function fpLikelihood(score: number): Likelihood {
    return score >= FP_LIKELY ? 'likely' : score >= FP_POSSIBLE ? 'possible' : 'unlikely';
}

/** For a hostname that already scored above the reporting threshold. */
function dnsLikelihood(score: number): Likelihood {
    return score > DNS_LIKELY ? 'likely' : 'possible';
}

/** API categories as words, most identifying first (e.g. canvas before screen size). */
function techniqueWords(categories: string[]): string[] {
    const sorted = unique(categories).sort((a, b) => (FP_CATEGORY_WEIGHTS[b] ?? 0) - (FP_CATEGORY_WEIGHTS[a] ?? 0));
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
                        likelihood: fpLikelihood(score),
                        score,
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

export type SignalId = 'generated-code';

export interface Signal {
    id: SignalId;
    /** What was observed, e.g. "14 of 14 fingerprinting APIs read by code generated at runtime". */
    text: string;
}

/** The signals any of the scripts show, for the overview; it only says that they occur, not how often. */
function pageSignals(scripts: ScriptDetail[]): string[] {
    const occurs = (id: SignalId) => scripts.some((s) => s.signals.some((signal) => signal.id === id));

    return [occurs('generated-code') ? 'Fingerprinting APIs read by code generated at runtime' : ''].filter(Boolean);
}

/** Signs that a script hides what it does, from where its calls came from. */
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

    return signals;
}

/** The spike with the highest score, as different APIs read and its duration. */
function strongestBurst(spikes: (SpikeSnapshot | null)[]): ScriptDetail['burst'] {
    const strongest = spikes
        .map((spike) => spike?.fpMetrics)
        .filter((metrics) => metrics != null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!strongest || strongest.distinctFpApis.length < MIN_BURST_APIS) return null;
    return { apis: strongest.distinctFpApis.length, durationMs: strongest.durationMs };
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
    const byHost = new Map<string, HostnameDetail>();
    for (const req of snapshot.dnsTrackingRequests ?? []) {
        const score = req.subdomainScore ?? 0;
        const host = req.hostname ?? hostOf(req.url);
        if (score <= DNS_POSSIBLE || !host) continue;

        const detail = byHost.get(host) ?? { host, likelihood: dnsLikelihood(score), score, requests: [] };
        detail.score = Math.max(detail.score, score);
        detail.likelihood = dnsLikelihood(detail.score);
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
