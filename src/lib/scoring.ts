// The one place that defines how the extension scores what it observes.
//
// Every score is made of signals. A signal is something observed, as a value from 0 to 1 (e.g. how
// many unusual fingerprinting APIs a script read, 1 meaning "a lot"). Each signal has a strength:
// how high the score gets from this signal alone, e.g. 0.6 for "up to 60% likely". Signals combine
// as independent evidence, each closing its share of the remaining gap to 1:
//
//     score = 1 - (1 - strength1 * value1) * (1 - strength2 * value2) * ...
//
// So a signal that isn't present changes nothing, adding a signal never needs the others adjusted,
// and a score can never exceed 1. Strengths and the likelihood cutoffs can be changed by the user on
// the options page; the defaults and the "full at" limits are defined here.
import { browser } from 'wxt/browser';
import { FP_APIS, FP_APIS_BY_ID } from './fp-apis';

export interface SignalDefinition {
    label: string;
    description: string;
    /** Default strength: how high the score gets from this signal alone, from 0 to 1. */
    strength: number;
}

/** The signals of each score, in the order the options page lists them. */
export const SIGNALS = {
    burst: {
        identifying: {
            label: 'Identifying information',
            description:
                'How much identifying information the burst reads: the entropy of the different fingerprinting APIs it reads, added up. Those revealing the same information count once.',
            strength: 0.3,
        },
        unusualApis: {
            label: 'Unusual fingerprinting APIs',
            description:
                'How many fingerprinting APIs the burst reads that ordinary code rarely needs: their rarity added up, rare ones counting more. Reading them shows intent even when they reveal little.',
            strength: 0.85,
        },
        generatedCode: {
            label: 'Fingerprinting APIs read by generated code',
            description:
                'How many unusual fingerprinting APIs the burst reads in code generated at runtime (new Function, eval), which hides what it does.',
            strength: 0.5,
        },
        onePlace: {
            label: 'Fingerprinting APIs from one place',
            description:
                'How many unusual fingerprinting APIs it reads from a single place in the code, counted like "Unusual fingerprinting APIs": ordinary code reads each where it needs it, fingerprinting collects through one loop or virtual machine instruction.',
            strength: 0.6,
        },
        dataSent: {
            label: 'Data sent right after',
            description: 'How suspicious the most suspicious request is that the script made right after the burst.',
            strength: 0,
        },
    },
    script: {
        identifying: {
            label: 'Identifying information',
            description:
                'How much identifying information the script reads beyond its strongest burst: the entropy of those fingerprinting APIs, added up. Those revealing the same information count once. A fallback for collecting spread out or split into several bursts.',
            strength: 0.15,
        },
        unusualApis: {
            label: 'Unusual fingerprinting APIs',
            description:
                'How many fingerprinting APIs the script reads beyond its strongest burst that ordinary code rarely needs: their rarity added up, rare ones counting more. A fallback for collecting spread out or split into several bursts.',
            strength: 0.7,
        },
        onePlace: {
            label: 'Fingerprinting APIs from one place',
            description:
                'How many unusual fingerprinting APIs beyond its strongest burst it reads from a single place in the code, counted like "Unusual fingerprinting APIs": ordinary code reads each where it needs it, fingerprinting collects through one loop or virtual machine instruction.',
            strength: 0.6,
        },
        strongestBurst: { label: 'Strongest burst', description: 'The score of its most suspicious burst of calls.', strength: 1 },
        repeatedBursts: { label: 'Repeated bursts', description: 'How many of its bursts are rated likely on their own.', strength: 0 },
        generatedCode: {
            label: 'Fingerprinting APIs read by generated code',
            description:
                'How many unusual fingerprinting APIs beyond its strongest burst the script reads in code it generates at runtime (new Function, eval), which hides what it does.',
            strength: 0.5,
        },
    },
    page: {
        identifying: {
            label: 'Identifying information',
            description:
                'How much identifying information the page (all scripts together) reads: the entropy of the different fingerprinting APIs it reads, added up. Those revealing the same information count once.',
            strength: 0,
        },
        unusualApis: {
            label: 'Unusual fingerprinting APIs',
            description:
                'How many fingerprinting APIs the page (all scripts together) reads that ordinary code rarely needs: their rarity added up, rare ones counting more. Reading them shows intent even when they reveal little.',
            strength: 0,
        },
        strongestScript: { label: 'Strongest script', description: 'The score of the most suspicious script.', strength: 1 },
        strongestBurst: { label: 'Strongest burst', description: 'The score of the most suspicious burst of calls on the page, across all its scripts: catches collecting split over several scripts.', strength: 0.3 },
        generatedCode: {
            label: 'Fingerprinting APIs read by generated code',
            description: 'The most unusual fingerprinting APIs a script on the page reads in code generated at runtime (new Function, eval).',
            strength: 0,
        },
    },
    request: {
        cnameCloaked: { label: 'CNAME-cloaked host', description: 'The request goes to a site address that is an alias for another company.', strength: 0.4 },
        thirdParty: { label: 'Third party', description: 'The request ends up at another site.', strength: 0.3 },
        crossOrigin: { label: 'Other origin', description: 'The request goes to another origin than the page.', strength: 0.15 },
        sendsData: { label: 'Sends data', description: 'The request is a POST, PUT or PATCH.', strength: 0.3 },
        parameters: { label: 'URL parameters', description: 'How many parameters its address carries.', strength: 0.2 },
        bodySize: { label: 'Body size', description: 'How much data the request sends in its body, up to 4 KB.', strength: 0.3 },
    },
    hostname: {
        randomness: { label: 'Random-looking', description: 'How random the longest part of the hostname looks, counting only long parts.', strength: 0.5 },
        digits: { label: 'Many digits', description: 'A high share of digits in it.', strength: 0.2 },
        fewVowels: { label: 'Few vowels', description: 'A low share of vowels, unlike words.', strength: 0.15 },
        encodedId: { label: 'Looks like an encoded ID', description: 'It looks like hex, base32, base64 or a UUID.', strength: 0.2 },
        length: { label: 'Length', description: 'How long it is beyond 25 characters.', strength: 0.15 },
        hyphens: { label: 'Hyphens', description: 'A high share of hyphens.', strength: 0.05 },
    },
} satisfies Record<string, Record<string, SignalDefinition>>;

export type ScoreLevel = keyof typeof SIGNALS;
export type SignalKey<L extends ScoreLevel> = keyof (typeof SIGNALS)[L] & string;
/** A value from 0 to 1 per signal of a level. */
export type SignalValues<L extends ScoreLevel> = Record<SignalKey<L>, number>;

/** What a signal is made from: another level's score, or the APIs read (see apisSums). */
export type SignalSource = ScoreLevel | 'apis';

/** The signals made from another score or from the APIs read; the options page nests them. */
export const SIGNAL_SOURCES: { [L in ScoreLevel]?: Partial<Record<SignalKey<L>, SignalSource>> } = {
    page: { strongestScript: 'script', strongestBurst: 'burst', identifying: 'apis', unusualApis: 'apis', generatedCode: 'apis' },
    script: { strongestBurst: 'burst', repeatedBursts: 'burst', identifying: 'apis', unusualApis: 'apis', onePlace: 'apis', generatedCode: 'apis' },
    burst: { identifying: 'apis', unusualApis: 'apis', generatedCode: 'apis', onePlace: 'apis', dataSent: 'request' },
};

export const LEVEL_LABELS: Record<ScoreLevel, string> = {
    page: 'Page',
    script: 'Script',
    burst: 'Burst of calls',
    request: 'Request after a burst',
    hostname: 'ID-like hostname',
};

/** Where a score counts as possible or likely. */
export interface Cutoffs {
    possible: number;
    likely: number;
}

/** The levels that score which fingerprinting APIs were read. */
export type ApisLevel = 'burst' | 'script' | 'page';

/** Where the API signals count as full (value 1): the added-up entropy and rarity. */
export interface ApisFullAt {
    identifying: number;
    unusual: number;
}

export interface ApiTraits {
    entropy: number;
    rarity: number;
}

export interface ScoringSettings {
    strengths: { [L in ScoreLevel]: SignalValues<L> };
    cutoffs: { fingerprinting: Cutoffs; hostname: Cutoffs };
    /** Entropy and rarity per fingerprinting API, by API id (see FpApi and apisSums). */
    apis: Record<string, ApiTraits>;
    /**
     * How much more rare APIs count than everyday ones in the unusual APIs signals: each API counts
     * its rarity to this power. 1 counts rarity as it is; at 2, rarity 0.2 counts 0.04 and 0.9
     * counts 0.81, so the many everyday reads of ordinary code add up to little.
     */
    rarityPower: number;
    /** Per level, where the API signals count as full. */
    fullAt: Record<ApisLevel, ApisFullAt>;
}

export const DEFAULT_SETTINGS: ScoringSettings = {
    strengths: Object.fromEntries(
        Object.entries(SIGNALS).map(([level, signals]) => [level, Object.fromEntries(Object.entries(signals).map(([key, s]) => [key, s.strength]))])
    ) as ScoringSettings['strengths'],
    cutoffs: {
        fingerprinting: { possible: 0.35, likely: 0.75 },
        hostname: { possible: 0.3, likely: 0.6 },
    },
    apis: Object.fromEntries(FP_APIS.map((api) => [api.id, { entropy: api.entropy, rarity: api.rarity }])),
    rarityPower: 2,
    fullAt: {
        burst: { identifying: 4.5, unusual: 4.5 },
        // Higher than for bursts: over a whole script they are a fallback for collecting without
        // bursts, and ordinary scripts read far more over their lifetime than in one burst.
        // They count only what a script read beyond its strongest burst. Both are full at about what large
        // collectors gather in their lifetime. Identifying information has a low strength: over a
        // lifetime, ordinary scripts (YouTube's app: 6.4) collect as much as smaller collectors, so
        // only the unusual APIs tell them apart. Together they stay just below Likely
        // (1 - 0.85 × 0.3): collecting spread out alone is Possible.
        script: { identifying: 10, unusual: 10 },
        page: { identifying: 20, unusual: 22 },
    },
};

// ---------- limits ----------
// Where the other signals' values reach 1 ("full at"). Not user settings: they say what "a lot" means.

export const LIMITS = {
    script: { repeatedBursts: 3 },
    request: { parameters: 5, bodyBytes: 4096 },
} as const;

/**
 * What counts as a burst of calls: one collection of details (see spike-detection). Fingerprinters
 * collect early and at once, pausing only for asynchronous APIs or to keep the page responsive;
 * measured collections took 13–362 ms with pauses up to 190 ms.
 */
export const BURST_DETECTION = {
    /** A burst goes on while calls are at most this many milliseconds apart. */
    maxGapMs: 200,
    /** Longer runs are split, so code reading the same details over and over isn't one endless burst. */
    maxDurationMs: 1000,
    /** Fewer different APIs are a couple of reads, not a collection. */
    minDistinctApis: 4,
    /**
     * Requests the script makes up to this many milliseconds after a burst count as sent right after
     * it; collected data is often sent only after processing (Kasada: 641 ms).
     */
    requestWindowMs: 1000,
};

// ---------- combining ----------

/** Combines a level's signal values into a score from 0 to 1, using the settings' strengths. */
export function combine<L extends ScoreLevel>(level: L, values: SignalValues<L>, settings: ScoringSettings): number {
    const strengths = settings.strengths[level];
    let remaining = 1;
    for (const key of Object.keys(values) as SignalKey<L>[]) {
        remaining *= 1 - clamp01(strengths[key]) * clamp01(values[key]);
    }
    return 1 - remaining;
}

/** One signal's part in a score: what it contributes alone is strength × value. */
export interface SignalPart {
    value: number;
    strength: number;
    /** For a signal made from the APIs read: what each of them added (see apisSums). */
    apis?: ApisSum;
}

/** A score and the parts it was combined from, by signal key (see combine). */
export interface ScoredParts {
    score: number;
    parts: Record<string, SignalPart>;
}

/**
 * Like combine, but also keeps each signal's value and strength, to show how a score came about;
 * `apis` adds what each API added to the signals made from the APIs read.
 */
export function combineParts<L extends ScoreLevel>(
    level: L,
    values: SignalValues<L>,
    settings: ScoringSettings,
    apis: Partial<Record<SignalKey<L>, ApisSum>> = {}
): ScoredParts {
    const strengths = settings.strengths[level];
    const parts: Record<string, SignalPart> = {};
    for (const key of Object.keys(values) as SignalKey<L>[]) {
        parts[key] = { value: clamp01(values[key]), strength: clamp01(strengths[key]), apis: apis[key] };
    }
    return { score: combine(level, values, settings), parts };
}

/** `value` relative to where it counts as full, from 0 to 1. */
export function saturate(value: number, fullAt: number): number {
    return fullAt > 0 ? clamp01(value / fullAt) : 0;
}

/** What one API added to an API signal. */
export interface ApiAmount {
    id: string;
    /** Its entropy or rarity, as set. */
    basis: number;
    /** What it added: the entropy, or the rarity to rarityPower; 0 if an API with the same information counted instead. */
    amount: number;
    /** The API with the same information that counted instead of this one. */
    countedWith?: string;
}

/** An API signal's sum: its value from 0 to 1, the total it was made from and what each API added. */
export interface ApisSum {
    measure: 'entropy' | 'rarity';
    value: number;
    total: number;
    fullAt: number;
    /** Most added first. */
    apis: ApiAmount[];
}

/**
 * The API signals' sums for the different APIs read, with what each API added (see ApisSum):
 * identifying information (Σ entropy), how much they reveal, and unusual APIs (Σ rarity ^
 * rarityPower), how unusual it is to read them. The two are independent: the user agent reveals a
 * lot but everyone reads it, navigator.webdriver reveals nothing but checking it shows intent.
 *
 * APIs that reveal the same value (see FpApi.same, e.g. the WebGL and WebGL2 versions of a call,
 * or the pixels of a canvas exported in two formats) count once together, as the highest of them.
 */
export function apisSums(distinctApis: Iterable<string>, level: ApisLevel, settings: ScoringSettings): { identifying: ApisSum; unusual: ApisSum } {
    const identifying = new SameSum('entropy');
    const unusual = new SameSum('rarity');
    for (const id of distinctApis) {
        const traits = settings.apis[id];
        if (!traits) continue;
        const information = FP_APIS_BY_ID[id]?.same ?? id;
        const entropy = clamp01(traits.entropy);
        const rarity = clamp01(traits.rarity);
        identifying.add(id, information, entropy, entropy);
        unusual.add(id, information, rarity, rarity ** Math.max(0, settings.rarityPower));
    }
    const fullAt = settings.fullAt[level];
    return { identifying: identifying.sum(fullAt.identifying), unusual: unusual.sum(fullAt.unusual) };
}

/** Amounts added up, each piece of information once: as the API adding the most for it. */
class SameSum {
    private readonly items: { id: string; information: string; basis: number; amount: number }[] = [];

    constructor(private readonly measure: ApisSum['measure']) {}

    add(id: string, information: string, basis: number, amount: number) {
        this.items.push({ id, information, basis, amount });
    }

    sum(fullAt: number): ApisSum {
        const counted = new Map<string, (typeof this.items)[number]>();
        for (const item of this.items) {
            const best = counted.get(item.information);
            if (!best || item.amount > best.amount) counted.set(item.information, item);
        }
        let total = 0;
        for (const item of counted.values()) total += item.amount;
        const apis = this.items
            .map(({ id, information, basis, amount }): ApiAmount => {
                const best = counted.get(information)!;
                return best.id === id ? { id, basis, amount } : { id, basis, amount: 0, countedWith: best.id };
            })
            .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
        return { measure: this.measure, value: saturate(total, fullAt), total, fullAt, apis };
    }
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// ---------- user settings ----------

const STORAGE_KEY = 'scoringSettings';

/** The user's settings, with defaults for anything not set (e.g. signals added since). */
export async function loadScoringSettings(): Promise<ScoringSettings> {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<ScoringSettings> | undefined;
    return withDefaults(stored);
}

export function saveScoringSettings(settings: ScoringSettings): Promise<void> {
    return browser.storage.local.set({ [STORAGE_KEY]: settings });
}

export function resetScoringSettings(): Promise<void> {
    return browser.storage.local.remove(STORAGE_KEY);
}

/** Calls `onChange` with the new settings whenever the user changes them. */
export function watchScoringSettings(onChange: (settings: ScoringSettings) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && STORAGE_KEY in changes) onChange(withDefaults(changes[STORAGE_KEY]!.newValue as Partial<ScoringSettings> | undefined));
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}

function withDefaults(stored: Partial<ScoringSettings> | undefined): ScoringSettings {
    const strengths = Object.fromEntries(
        (Object.keys(DEFAULT_SETTINGS.strengths) as ScoreLevel[]).map((level) => [
            level,
            { ...DEFAULT_SETTINGS.strengths[level], ...stored?.strengths?.[level] },
        ])
    ) as ScoringSettings['strengths'];
    return {
        strengths,
        cutoffs: {
            fingerprinting: { ...DEFAULT_SETTINGS.cutoffs.fingerprinting, ...stored?.cutoffs?.fingerprinting },
            hostname: { ...DEFAULT_SETTINGS.cutoffs.hostname, ...stored?.cutoffs?.hostname },
        },
        apis: Object.fromEntries(
            Object.entries(DEFAULT_SETTINGS.apis).map(([id, traits]) => [id, { ...traits, ...stored?.apis?.[id] }])
        ),
        rarityPower: stored?.rarityPower ?? DEFAULT_SETTINGS.rarityPower,
        fullAt: {
            burst: { ...DEFAULT_SETTINGS.fullAt.burst, ...stored?.fullAt?.burst },
            script: { ...DEFAULT_SETTINGS.fullAt.script, ...stored?.fullAt?.script },
            page: { ...DEFAULT_SETTINGS.fullAt.page, ...stored?.fullAt?.page },
        },
    };
}
