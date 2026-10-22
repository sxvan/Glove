import { blockKey } from '@/lib/blocking';
import { placeKey } from '@/lib/call-stack';
import { FP_APIS_BY_ID, fpCategoryName } from '@/lib/fp-apis';
import { type ApiTraits, rareIdentifyingBits } from '@/lib/scoring';
import type { ViewerApi, ViewerParams } from '@/lib/script-viewer';
import type { CallLocation, TabSnapshot } from '@/types/snapshot';
import { capitalize } from '../format';
import { type ApiDetail, apiDetails, apiList } from './apis';
import { allRequests, type SentRequest, sentRequests } from './requests';
import { type ScoreNode, scriptTree } from './score-tree';
import { fpLikelihood, type Likelihood, rareBitsOf } from './shared';
import { type StoredDetail, storedDetails } from './stored';
import { cloakedHosts, describeScript, hostOf, linkableUrl, originTitle, realHost, realSite, urlPath } from './urls';

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
    /** Its file, or for an inline script its page; null for generated scripts and URLs other than http(s). */
    viewer: ViewerParams | null;
    /** The script's own host if it is such an alias, which origin then goes "through"; null otherwise. */
    via: string | null;
    likelihood: Likelihood;
    score: number;
    tree: ScoreNode[];
    calls: number;
    /** Whether its calls reached a limit (see lib/limits), so there were more than `calls`. */
    capped: boolean;
    /** What it learned about the device, by kind of detail, the most identifying kind first. */
    learned: LearnedKind[];
    /** Signs that the script hides what it does; empty if there are none. */
    signals: Signal[];
    /** Fingerprinting APIs with call counts (null if unknown) and call positions, most called first. */
    apis: ViewerApi[];
    /** The fingerprinting APIs it read, those counting most toward the score first. */
    apiDetails: ApiDetail[];
    /** Requests carrying data that the script made right after fingerprinting, the most data first. */
    sent: SentRequest[];
    /** All requests carrying data it made, at any time: those right after reading with how long after. */
    requests: SentRequest[];
    /**
     * The site's own addresses that are CNAME aliases for another site, which it made requests to at
     * any time, with the site each leads to; for the page, those of all its requests.
     */
    aliased: { host: string; site: string }[];
    /** Cookies and storage items it wrote (see byIdentifier). */
    stored: StoredDetail[];
}

/** A kind of detail a script read, e.g. "Graphics card", with what it learned: "name, rendered 3D image". */
export interface LearnedKind {
    kind: string;
    facts: string[];
}

/** A blocked script that tried to load on the page (see lib/blocking). */
export interface BlockedDetail {
    /** What it is blocked by (see blockKey). */
    key: string;
    /** Its URL path, and its host. */
    name: string;
    origin: string;
    url: string;
    /** How often it tried to load, in all the page's frames. */
    attempts: number;
}

/** The blocked scripts that tried to load on the page, the most attempts first. */
export function blockedDetails(snapshot: TabSnapshot): BlockedDetail[] {
    const byKey = new Map<string, BlockedDetail>();
    for (const frame of snapshot.frames) {
        for (const attempt of frame?.document.blockedScripts ?? []) {
            const key = blockKey(attempt.url);
            if (!key) continue;
            const known = byKey.get(key);
            if (known) known.attempts += attempt.attempts;
            else byKey.set(key, { key, name: urlPath(attempt.url), origin: hostOf(attempt.url), url: attempt.url, attempts: attempt.attempts });
        }
    }
    return [...byKey.values()].sort((a, b) => b.attempts - a.attempts);
}

/** Scripts that called fingerprinting APIs, across all frames, most suspicious first. */
export function fingerprintingDetails(snapshot: TabSnapshot): ScriptDetail[] {
    const cutoffs = snapshot.cutoffs;
    const traits = snapshot.apis;
    const power = snapshot.rarityPower;
    const rare = rareBitsOf(snapshot);
    const aliases = cloakedHosts(snapshot);

    return snapshot.frames
        .filter((f) => f !== null)
        .flatMap((frame) =>
            frame.document.scripts
                .filter((s) => (s.fpMetrics?.intensity ?? 0) > 0)
                .map((script): ScriptDetail => {
                    const { name, path, origin, host, linkable, inline } = describeScript(script.name, frame.document.url);
                    const score = script.fpMetrics?.score ?? 0;
                    // Sent right after reading: only after bursts that are possible fingerprinting on their own, as for what it stored (see storedDetails).
                    const correlations = script.bursts
                        .filter((burst) => (burst.fpMetrics?.score ?? 0) >= cutoffs.fingerprinting.possible)
                        .flatMap((burst) => {
                            const burstEnd = Math.max(...burst.events.map((event) => event.timeStamp));
                            return (burst.httpCorrelations ?? []).map((correlation) => ({ ...correlation, burstEnd }));
                        });
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
                        via: host && aliases.has(host) ? host : null,
                        likelihood: fpLikelihood(score, cutoffs),
                        score,
                        tree: scriptTree(script),
                        calls: script.fpMetrics?.intensity ?? 0,
                        capped: script.capped === true || snapshot.callsCapped === true,
                        learned: learnedKinds(script.fpMetrics?.distinctFpApis ?? [], rare),
                        signals: scriptSignals(script.apiLocations, traits, power, rare),
                        apis,
                        sent: sentRequests(correlations, aliases),
                        requests: allRequests(script.requests, correlations, aliases),
                        aliased: script.cloakedHosts.map((host) => ({ host, site: realSite(host, aliases) ?? host })),
                        stored: storedDetails(snapshot, script),
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
    /** The kinds of detail of the APIs it is about, the most identifying first (see learnedKinds). */
    kinds: string[];
    /** Why it is a sign of fingerprinting, in a sentence, for the tip of its line. */
    explanation: string;
}

/**
 * Different APIs read from one place in the code from which a script's card mentions it. Ordinary
 * scripts read at most 2 there (e.g. { innerWidth, innerHeight } = window); the score counts from 3 on.
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
            kinds: kindsOf(generated),
            explanation:
                'Code the script creates while the page runs (with eval or new Function) is not in its file, so reading the file doesn\u2019t show what it does: a way to hide fingerprinting. Shown when what it reads that way adds at least 1 rare bit.',
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
            kinds: kindsOf(fromOnePlace),
            explanation:
                'Ordinary code reads each detail where it needs it, at most 2 in one place (e.g. the window\u2019s width and height). Collecting many through one loop is typical of fingerprinting. Shown from 5 different APIs read at one place, when they add at least 1 rare bit.',
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
export function learnedKinds(apiIds: string[], rare: Record<string, number>): LearnedKind[] {
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
