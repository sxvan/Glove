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
import { DEFAULT_IDENTIFIER_RULES, type IdentifierRules } from './identifiers';
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
        rareIdentifying: {
            label: 'Rare identifying fingerprinting APIs',
            description:
                'How much identifying information the burst reads through APIs ordinary code rarely needs: the bits of each API, those revealing the same value once and overlapping ones what they add, times its rarity to rarityPower, added up. Intent and what is revealed at once, as in reading a hidden canvas, probing fonts or rendering audio; everyday reads like the window size count next to nothing, and so do checks that reveal little.',
            strength: 0.9,
        },
        generatedCode: {
            label: 'Fingerprinting APIs from generated code',
            description:
                'How many rare identifying fingerprinting APIs the burst reads in code generated at runtime (new Function, eval), which hides what it does, counted like "Rare identifying fingerprinting APIs".',
            strength: 0.25,
        },
        onePlace: {
            label: 'Fingerprinting APIs from one place',
            description:
                'How many rare identifying fingerprinting APIs it reads from a single place in the code, counted like "Rare identifying fingerprinting APIs": ordinary code reads each where it needs it, fingerprinting collects through one loop or virtual machine instruction.',
            strength: 0.25,
        },
    },
    script: {
        strongestBurst: { label: 'Strongest burst', description: 'The score of its most suspicious burst of calls.', strength: 1 },
        beyondBurst: {
            label: 'Outside the burst',
            description:
                'What the script read outside its strongest burst, on top of what the burst read: a fallback for collecting spread out or split into several bursts.',
            strength: 1,
        },
        cnameCloaked: {
            label: 'Served through a CNAME alias',
            description:
                "The script comes from an address of the site that is an alias (CNAME) for another site, which hides who really serves it from blockers. A small extra: sites also serve their own scripts through CDNs this way.",
            strength: 0.15,
        },
        sentThroughAlias: {
            label: 'Sent data through a CNAME alias',
            description:
                "Right after reading, the script sent data to an address of the site that is an alias (CNAME) for another site. Cookies sent with it count as the site's own, which gets around limits on third-party cookies, and blockers that only know the other site miss it.",
            strength: 0.15,
        },
    },
    // A script outside its strongest burst: only APIs the burst didn't read (see computeScriptFpScore).
    scriptBeyondBurst: {
        rareIdentifying: {
            label: 'Rare identifying fingerprinting APIs',
            description:
                'How much identifying information the script reads outside its strongest burst through APIs ordinary code rarely needs, counted as for a burst, on top of what the burst read, toward full. Counts as much as in a burst, so a collection split into several bursts or spread out counts like one in a single go.',
            strength: 0.9,
        },
        onePlace: {
            label: 'Fingerprinting APIs from one place',
            description:
                'How many rare identifying fingerprinting APIs beyond its strongest burst it reads from a single place in the code, counted like "Rare identifying fingerprinting APIs".',
            strength: 0.25,
        },
        generatedCode: {
            label: 'Fingerprinting APIs from generated code',
            description:
                'How many rare identifying fingerprinting APIs beyond its strongest burst the script reads in code it generates at runtime (new Function, eval), which hides what it does.',
            strength: 0.25,
        },
    },
    // The page in two parts, each API counted in one only: its strongest script in full, and the
    // other scripts on top of it, scored like a script: their strongest burst, and what they read
    // beyond it (see computeDocumentFpScore).
    page: {
        strongestScript: { label: 'Strongest script', description: 'The score of the most suspicious script, counted in full.', strength: 1 },
        otherScripts: {
            label: 'Other scripts',
            description: 'What the other scripts read, on top of the strongest script, scored like a script: catches collecting split over several scripts. Counts half: scripts start together when the page loads, and they come from different vendors without coordination.',
            strength: 0.5,
        },
    },
    otherScripts: {
        strongestBurst: {
            label: 'Strongest burst',
            description:
                'The score of the most suspicious burst of calls of the other scripts, on top of the strongest script: what they read together in one go beyond what it read.',
            strength: 1,
        },
        beyondBurst: {
            label: 'Outside the burst',
            description:
                'What the other scripts read outside their strongest burst, on top of what the strongest script and the burst read: a weak fallback for collecting spread over several scripts and over time.',
            strength: 1,
        },
    },
    // The other scripts outside their strongest burst: only APIs neither the strongest script nor the
    // burst read (see computeDocumentFpScore).
    otherScriptsBeyondBurst: {
        rareIdentifying: {
            label: 'Rare identifying fingerprinting APIs',
            description:
                'How much identifying information the other scripts read outside their strongest burst through APIs ordinary code rarely needs, on top of what the strongest script and the burst read, toward the full 13.',
            strength: 0.9,
        },
        onePlace: {
            label: 'Fingerprinting APIs from one place',
            description:
                'How many rare identifying fingerprinting APIs one of the other scripts reads from a single place in its code outside their strongest burst, beyond those the strongest script and the burst read.',
            strength: 0.25,
        },
        generatedCode: {
            label: 'Fingerprinting APIs from generated code',
            description:
                'The most rare identifying fingerprinting APIs one of the other scripts reads outside their strongest burst in code generated at runtime (new Function, eval).',
            strength: 0.25,
        },
    },
} satisfies Record<string, Record<string, SignalDefinition>>;

export type ScoreLevel = keyof typeof SIGNALS;
type SignalKey<L extends ScoreLevel> = keyof (typeof SIGNALS)[L] & string;
/** A value from 0 to 1 per signal of a level. */
export type SignalValues<L extends ScoreLevel> = Record<SignalKey<L>, number>;

/** What a signal is made from: another level's score, or the APIs read (see apisSums). */
export type SignalSource = ScoreLevel | 'apis';

/** The signals made from another score or from the APIs read; the options page nests them. */
export const SIGNAL_SOURCES: { [L in ScoreLevel]?: Partial<Record<SignalKey<L>, SignalSource>> } = {
    page: { strongestScript: 'script', otherScripts: 'otherScripts' },
    otherScripts: { strongestBurst: 'burst', beyondBurst: 'otherScriptsBeyondBurst' },
    otherScriptsBeyondBurst: { rareIdentifying: 'apis', onePlace: 'apis', generatedCode: 'apis' },
    script: { strongestBurst: 'burst', beyondBurst: 'scriptBeyondBurst' },
    scriptBeyondBurst: { rareIdentifying: 'apis', onePlace: 'apis', generatedCode: 'apis' },
    burst: { rareIdentifying: 'apis', generatedCode: 'apis', onePlace: 'apis' },
};

export const LEVEL_LABELS: Record<ScoreLevel, string> = {
    page: 'Page',
    otherScripts: 'Other scripts',
    otherScriptsBeyondBurst: 'Other scripts outside their burst',
    script: 'Script',
    scriptBeyondBurst: 'Script outside its burst',
    burst: 'Burst of calls',
};

/** Where a score counts as possible or likely. */
export interface Cutoffs {
    possible: number;
    likely: number;
}

/**
 * The levels that score which fingerprinting APIs were read. A page burst is a burst of calls
 * across all of a page's scripts: scored like a script's burst, but full at more, as many scripts
 * starting up together read more than one script does.
 */
export type ApisLevel = 'burst' | 'pageBurst' | 'script' | 'page';

export const APIS_LEVEL_LABELS: Record<ApisLevel, string> = {
    page: 'Other scripts beyond their burst',
    script: 'Script',
    pageBurst: 'Burst of the other scripts',
    burst: 'Burst of calls in a script',
};

/** Where the API signals count as full (value 1): the added-up rare bits. */
export interface ApisFullAt {
    rareIdentifying: number;
}

export interface ApiTraits {
    /** Its identifying information on its own, in bits (see FpApi.bits). */
    bits: number;
    /** The bits it adds once another API of its overlap group counted (see FpApi.overlap); its bits if it has no group. */
    adds: number;
    rarity: number;
}

export interface ScoringSettings {
    strengths: { [L in ScoreLevel]: SignalValues<L> };
    cutoffs: { fingerprinting: Cutoffs };
    /** Bits and rarity per fingerprinting API, by API id (see FpApi and apisSums). */
    apis: Record<string, ApiTraits>;
    /**
     * How much more rare APIs count than everyday ones in the unusual APIs signals: each API counts
     * its rarity to this power. 1 counts rarity as it is; at 4, rarity 0.6 (read on 40% of page
     * loads) counts 0.13 and 0.93 counts 0.75, so the many everyday reads of ordinary code add up to
     * little. Calibrated with the rarities from Chrome's usage data (see FP_APIS).
     */
    rarityPower: number;
    /** Per level, where the API signals count as full. */
    fullAt: Record<ApisLevel, ApisFullAt>;
    /** What counts as a burst of calls, and which requests count as sent right after one. */
    bursts: BurstDetection;
    /** What counts as a possible identifier among the values scripts store (see lib/identifiers). */
    identifiers: IdentifierRules;
}

export const DEFAULT_SETTINGS: ScoringSettings = {
    strengths: Object.fromEntries(
        Object.entries(SIGNALS).map(([level, signals]) => [level, Object.fromEntries(Object.entries(signals).map(([key, s]) => [key, s.strength]))])
    ) as ScoringSettings['strengths'],
    cutoffs: {
        // A script's score comes almost all from its rare identifying APIs (about 0.9 × rare bits / 13),
        // so the cutoffs stand for rare bits, and Tracker Radar's third-party scripts (see fullAt)
        // tell how many of those reaching them are rated fingerprinting. Possible from 30 (4.3 rare
        // bits): 85% of those scripts are fingerprinting, while below it the share stays around 75%
        // down to 15, where analytics and players reading many everyday APIs are. Likely from 65 (9.4
        // rare bits): 99% are; higher only leaves out fingerprinters (at 75, a quarter of those from
        // 65). The crawl doesn't see the particular reads, so fingerprinters score somewhat more here.
        // Measured: collectors 90 and more (Akamai, FingerprintJS, CNN's), security fingerprinting 64
        // to 77 (Google's sign-in and ad-traffic checks, Amazon's device script), YouTube's player 31
        // to 34, analytics up to about 20 (Apple's, BBC's, Microsoft Clarity).
        fingerprinting: { possible: 0.3, likely: 0.65 },
    },
    apis: Object.fromEntries(FP_APIS.map((api) => [api.id, { bits: api.bits, adds: api.overlap?.adds ?? api.bits, rarity: api.rarity }])),
    rarityPower: 4,
    // Rare identifying APIs (each API's bits, counted as for the bits read, times its rarity to
    // rarityPower, added up) are full at 13 on every level: where no ordinary script gets to any
    // more. Of DuckDuckGo's Tracker Radar's 51,426 third-party scripts (US crawl, 2026-10-09, each
    // once), 98% of those reaching 8 and all reaching 10 are rated fingerprinting, while below them
    // ordinary scripts appear; fingerprinters reach a median of 9. The crawl doesn't see the
    // particular reads (the graphics card name, hidden canvases, font probing), which add about 3
    // more, so 13 here. Measured collectors reach 13 to 26 in a burst (CNN's 13, FingerprintJS 23,
    // Akamai on Costco 26), ordinary scripts up to about 4 (YouTube's player, Cloudflare's bot check).
    //
    // Beyond the strongest burst or script (see apisSumsBeyond) it counts how much of the way to full
    // the rest still adds: once that reached full, nothing beyond adds to it.
    fullAt: {
        burst: { rareIdentifying: 13 },
        // A burst of the other scripts: the same measure as a script's burst, so the same value.
        pageBurst: { rareIdentifying: 13 },
        // A script outside its strongest burst.
        script: { rareIdentifying: 13 },
        // The other scripts outside their strongest burst.
        page: { rareIdentifying: 13 },
    },
    // Fingerprinters collect early and at once, pausing only for asynchronous APIs or to keep the
    // page responsive; measured collections took 13–362 ms with pauses up to 190 ms.
    bursts: { windowMs: 1000, minDistinctApis: 4, requestWindowMs: 1000 },
    identifiers: DEFAULT_IDENTIFIER_RULES,
};

/** What counts as a burst of calls: one collection of details (see spike-detection). */
export interface BurstDetection {
    /** How long a burst is at most: the window that slides over the calls (see spike-detection). */
    windowMs: number;
    /** Fewer different APIs are a couple of reads, not a collection. */
    minDistinctApis: number;
    /** Requests the script makes up to this many milliseconds after a burst count as sent right after it. */
    requestWindowMs: number;
}

/** The burst detection settings with their labels and explanations, in the order the options page lists them. */
export const BURST_DETECTION_FIELDS: { key: keyof BurstDetection; label: string; description: string; unit: string }[] = [
    {
        key: 'windowMs',
        label: 'Burst length',
        description:
            'A window of this length slides over the calls: the one reading the most unusual and identifying APIs is a burst, then the same with the calls left. Measured collections took 13 to 362 ms, pausing up to 190 ms for asynchronous APIs.',
        unit: 'ms',
    },
    {
        key: 'minDistinctApis',
        label: 'Fewest APIs',
        description: 'Runs reading fewer different fingerprinting APIs are a couple of reads, not a collection.',
        unit: 'APIs',
    },
    {
        key: 'requestWindowMs',
        label: 'Right after',
        description:
            'Requests with data a script makes, and values it stores, up to this long after a burst count as right after reading. Collected data is often sent only after processing it (Kasada: 641 ms).',
        unit: 'ms',
    },
];

/** The identifier rules with their labels and explanations, in the order the options page lists them. */
export const IDENTIFIER_RULE_FIELDS: { key: keyof IdentifierRules; label: string; description: string; unit: string }[] = [
    {
        key: 'lastingDays',
        label: 'Cookie kept for',
        description: 'A cookie kept at least this long identifies the browser across visits; 3 months, as in the studies. Local storage stays until cleared, session storage only until the tab closes.',
        unit: 'days',
    },
    {
        key: 'minLength',
        label: 'Shortest part',
        description: 'Values are split into parts at anything but letters, digits and the characters of base64 and UUIDs; shorter parts are too few to tell browsers apart.',
        unit: 'characters',
    },
    {
        key: 'maxLength',
        label: 'Longest part',
        description: 'Longer parts are data rather than an identifier; the longest common identifier, a SHA-512 hash in hex, has 128. Values are recorded up to 400 characters.',
        unit: 'characters',
    },
];

// ---------- combining ----------

/** Combines a level's signal values into a score from 0 to 1, using the settings' strengths. */
function combine<L extends ScoreLevel>(level: L, values: SignalValues<L>, settings: ScoringSettings): number {
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
    /** For a signal that is the score of a part made from its own signals (the rest of a page): those. */
    parts?: Record<string, SignalPart>;
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
function saturate(value: number, fullAt: number): number {
    return fullAt > 0 ? clamp01(value / fullAt) : 0;
}

/** What one API added to an API signal. */
export interface ApiAmount {
    id: string;
    /** Its bits, as set; for rare bits, the bits it counted (see amount for bits). */
    basis: number;
    /**
     * What it added: its bits (what it adds beyond an overlapping API, see overlapsWith), or those
     * bits times its rarity to rarityPower; 0 if an API with the same information counted instead.
     */
    amount: number;
    /** The API with the same information that counted instead of this one. */
    countedWith?: string;
    /** For bits: the API of its overlap group that counted all its bits, so this one only what it adds. */
    overlapsWith?: string;
    /** For a sum beyond known APIs (see apisSumsBeyond): whether countedWith or overlapsWith is one of those. */
    withKnown?: boolean;
    /** For rare bits: its bits on their own, its rarity, and that to rarityPower, which its counted bits are multiplied by. */
    bits?: number;
    rarity?: number;
    weight?: number;
}

/** An API signal's sum: its value from 0 to 1, the total it was made from and what each API added. */
export interface ApisSum {
    measure: 'bits' | 'rareBits';
    value: number;
    total: number;
    fullAt: number;
    /**
     * For a sum beyond known APIs (see apisSumsBeyond): the bits those already counted; the value is
     * then how much of what was still missing to fullAt the APIs here add.
     */
    known?: number;
    /** Most added first. */
    apis: ApiAmount[];
    /** For rare bits: the exponent each API's rarity counted with (see ScoringSettings.rarityPower). */
    rarityPower?: number;
}

/**
 * The bits the different APIs read reveal and the rare identifying APIs made from them, with what
 * each API added (see ApisSum). The bits: APIs that reveal the same value (see FpApi.same, e.g. the
 * WebGL and WebGL2 versions of a call, or the pixels of a canvas exported in two formats) count once
 * together, as the highest of them; of APIs whose values only overlap (see FpApi.overlap, e.g. the
 * screen's and the window's sizes), the one with the most bits counts all of them, the others only
 * what they add beyond it. The rare bits: each API's counted bits times its rarity to rarityPower,
 * as reading what ordinary code rarely needs shows intent: the user agent reveals a lot but everyone
 * reads it, navigator.webdriver is rarely read but reveals nothing, a hidden canvas is both.
 */
export function apisSums(distinctApis: Iterable<string>, level: ApisLevel, settings: ScoringSettings): ApisSums {
    const identifying = new SameSum('bits');
    for (const id of distinctApis) {
        const traits = settings.apis[id];
        if (!traits) continue;
        const api = FP_APIS_BY_ID[id];
        const bits = nonNegative(traits.bits);
        identifying.add(id, api?.same ?? id, bits, bits, api?.overlap ? { group: api.overlap.group, adds: Math.min(bits, nonNegative(traits.adds)) } : undefined);
    }
    const fullAt = settings.fullAt[level];
    const bits = identifying.sum(EVERYONE_BITS);
    return { identifying: bits, rareIdentifying: rareBits(bits, settings, fullAt.rareIdentifying) };
}

/**
 * Bits that tell everyone apart: about 5 billion people are online, and 2^33 is 8.6 billion. The
 * bits read count up to there (see ApisSums.identifying), which the popup shows.
 */
export const EVERYONE_BITS = 33;

/** The API sums (see apisSums): the bits read, which the popup shows, and the rare bits, which score. */
export interface ApisSums {
    identifying: ApisSum;
    rareIdentifying: ApisSum;
}

/**
 * Rare identifying APIs from what the APIs added to identifying APIs (`bits`): each API's counted
 * bits times its rarity to rarityPower. Beyond `known` rare bits already counted (see
 * apisSumsBeyond), the value is how much of the way from them to fullAt these add.
 */
function rareBits(bits: ApisSum, settings: ScoringSettings, fullAt: number, known?: number): ApisSum {
    const power = Math.max(0, settings.rarityPower);
    const apis = bits.apis
        .map((api): ApiAmount => {
            const rarity = clamp01(settings.apis[api.id]?.rarity ?? 0);
            const weight = rarity ** power;
            return { ...api, basis: api.amount, amount: api.amount * weight, bits: api.basis, rarity, weight };
        })
        .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
    const total = apis.reduce((sum, api) => sum + api.amount, 0);
    const value = known === undefined ? saturate(total, fullAt) : fullAt > 0 ? Math.min(total, Math.max(0, fullAt - known)) / fullAt : 0;
    return { measure: 'rareBits', value, total, fullAt, known, apis, rarityPower: power };
}

/**
 * The API signals for what `distinctApis` add on top of `knownApis`, which are already counted
 * elsewhere: a script's beyond its strongest burst, a page's beyond its strongest script.
 *
 * The bits start from those the known APIs reveal together, then add the others, the most bits
 * first: one revealing a value already counted adds nothing (or what it has more), one whose overlap
 * group already has a counted API (known or added before) adds what it adds beside it, any other its
 * bits.
 *
 * Rare identifying APIs are those amounts times rarity, likewise toward fullAt from the known
 * APIs' rare bits: known APIs reaching full already show what a fingerprinter collects.
 */
export function apisSumsBeyond(
    knownApis: Iterable<string>,
    distinctApis: Iterable<string>,
    level: ApisLevel,
    settings: ScoringSettings
): ApisSums {
    const known = new Set(knownApis);
    const baseSums = apisSums(known, level, settings);
    const base = baseSums.identifying;
    const fullAt = settings.fullAt[level];

    // What is counted so far: per value the API counting it and its bits, per overlap group an API of it.
    const values = new Map<string, { id: string; bits: number; known: boolean }>();
    const groups = new Map<string, { id: string; known: boolean }>();
    for (const api of base.apis) {
        if (api.countedWith) continue;
        const definition = FP_APIS_BY_ID[api.id];
        values.set(definition?.same ?? api.id, { id: api.id, bits: api.basis, known: true });
        const group = definition?.overlap?.group;
        if (group && !api.overlapsWith) groups.set(group, { id: api.id, known: true });
    }

    const added = [...new Set(distinctApis)]
        .filter((id) => !known.has(id) && settings.apis[id])
        .map((id) => ({ id, bits: nonNegative(settings.apis[id]!.bits), traits: settings.apis[id]! }))
        .sort((a, b) => b.bits - a.bits || a.id.localeCompare(b.id));
    const identifying: ApiAmount[] = [];
    for (const { id, bits, traits } of added) {
        const definition = FP_APIS_BY_ID[id];
        const value = definition?.same ?? id;
        const group = definition?.overlap?.group;
        const counted = values.get(value);
        const member = group ? groups.get(group) : undefined;
        if (counted) {
            // The same value: only what this API reveals more, as overlapping with the one counting it.
            const more = Math.max(0, bits - counted.bits);
            identifying.push(more > 0 ? { id, basis: bits, amount: more, overlapsWith: counted.id, withKnown: counted.known } : { id, basis: bits, amount: 0, countedWith: counted.id, withKnown: counted.known });
            if (more > 0) values.set(value, { id, bits, known: false });
        } else if (member) {
            identifying.push({ id, basis: bits, amount: Math.min(bits, nonNegative(traits.adds)), overlapsWith: member.id, withKnown: member.known });
            values.set(value, { id, bits, known: false });
        } else {
            identifying.push({ id, basis: bits, amount: bits });
            values.set(value, { id, bits, known: false });
            if (group) groups.set(group, { id, known: false });
        }
    }

    const byAmount = (a: ApiAmount, b: ApiAmount) => b.amount - a.amount || a.id.localeCompare(b.id);
    const addedBits = identifying.reduce((sum, api) => sum + api.amount, 0);
    const identifyingSum: ApisSum = {
        measure: 'bits',
        value: Math.min(addedBits, Math.max(0, EVERYONE_BITS - base.total)) / EVERYONE_BITS,
        total: addedBits,
        fullAt: EVERYONE_BITS,
        known: base.total,
        apis: identifying.sort(byAmount),
    };
    return {
        identifying: identifyingSum,
        rareIdentifying: rareBits(identifyingSum, settings, fullAt.rareIdentifying, baseSums.rareIdentifying.total),
    };
}

/** Each API's part in the rare bits of `distinctApis` read together (see apisSums), by API id. */
export function rareAmounts(distinctApis: Iterable<string>, apis: ScoringSettings['apis'], rarityPower: number): Map<string, ApiAmount> {
    const sums = apisSums(distinctApis, 'page', { ...DEFAULT_SETTINGS, apis, rarityPower });
    return new Map(sums.rareIdentifying.apis.map((api) => [api.id, api]));
}

/** Rare bits added up as the rare identifying APIs signal does (see apisSums), without its full-at. */
export function rareIdentifyingBits(distinctApis: Iterable<string>, apis: ScoringSettings['apis'], rarityPower: number): number {
    return apisSums(distinctApis, 'page', { ...DEFAULT_SETTINGS, apis, rarityPower }).rareIdentifying.total;
}

/** Bits added up as the identifying information signal does (see apisSums), without its full-at: for showing the total. */
export function identifyingBits(distinctApis: Iterable<string>, apis: ScoringSettings['apis']): number {
    return apisSums(distinctApis, 'page', { ...DEFAULT_SETTINGS, apis }).identifying.total;
}

/**
 * Amounts added up, each piece of information once: as the API adding the most for it. Of an
 * overlap group, the API adding the most counts its whole amount, the others what they add.
 */
class SameSum {
    private readonly items: { id: string; information: string; basis: number; amount: number; overlap?: { group: string; adds: number } }[] = [];

    constructor(private readonly measure: ApisSum['measure']) {}

    add(id: string, information: string, basis: number, amount: number, overlap?: { group: string; adds: number }) {
        this.items.push({ id, information, basis, amount, overlap });
    }

    sum(fullAt: number): ApisSum {
        const counted = new Map<string, (typeof this.items)[number]>();
        for (const item of this.items) {
            const best = counted.get(item.information);
            if (!best || item.amount > best.amount) counted.set(item.information, item);
        }
        // Per overlap group, the counted API with the most; it alone counts its whole amount.
        const leaders = new Map<string, (typeof this.items)[number]>();
        for (const item of counted.values()) {
            if (!item.overlap) continue;
            const leader = leaders.get(item.overlap.group);
            if (!leader || item.amount > leader.amount || (item.amount === leader.amount && item.id < leader.id)) leaders.set(item.overlap.group, item);
        }
        const apis = this.items
            .map(({ id, information, basis, amount, overlap }): ApiAmount => {
                const best = counted.get(information)!;
                if (best.id !== id) return { id, basis, amount: 0, countedWith: best.id };
                const leader = overlap ? leaders.get(overlap.group)! : undefined;
                return leader && leader.id !== id ? { id, basis, amount: overlap!.adds, overlapsWith: leader.id } : { id, basis, amount };
            })
            .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
        const total = apis.reduce((sum, api) => sum + api.amount, 0);
        return { measure: this.measure, value: saturate(total, fullAt), total, fullAt, apis };
    }
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function nonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// ---------- user settings ----------

const STORAGE_KEY = 'scoringSettings';

// The version of the stored settings' units (2: an API's identifying information in bits), to tell
// them apart should the units change again.
const SETTINGS_VERSION = 2;

type StoredSettings = Partial<ScoringSettings> & { version?: number };

/** The user's settings, with defaults for anything not set (e.g. signals added since). */
export async function loadScoringSettings(): Promise<ScoringSettings> {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as StoredSettings | undefined;
    return withDefaults(stored);
}

/**
 * Stores only what differs from the defaults, so a changed default (e.g. after recalibrating)
 * still reaches everyone who didn't set that value themselves.
 */
export function saveScoringSettings(settings: ScoringSettings): Promise<void> {
    const changed = (changedFrom(DEFAULT_SETTINGS, settings) ?? {}) as StoredSettings;
    return browser.storage.local.set({ [STORAGE_KEY]: { ...changed, version: SETTINGS_VERSION } });
}

/** The parts of `value` that differ from `base`, as a nested object; undefined if none do. */
function changedFrom(base: unknown, value: unknown): unknown {
    if (typeof value === 'object' && value !== null && typeof base === 'object' && base !== null) {
        const changed: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            const difference = changedFrom((base as Record<string, unknown>)[key], inner);
            if (difference !== undefined) changed[key] = difference;
        }
        return Object.keys(changed).length > 0 ? changed : undefined;
    }
    return value === base ? undefined : value;
}

export function resetScoringSettings(): Promise<void> {
    return browser.storage.local.remove(STORAGE_KEY);
}

/** Calls `onChange` with the new settings whenever the user changes them. */
export function watchScoringSettings(onChange: (settings: ScoringSettings) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && STORAGE_KEY in changes) onChange(withDefaults(changes[STORAGE_KEY]!.newValue as StoredSettings | undefined));
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}

function withDefaults(stored: StoredSettings | undefined): ScoringSettings {
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
        },
        apis: Object.fromEntries(
            Object.entries(DEFAULT_SETTINGS.apis).map(([id, traits]) => [id, { ...traits, ...stored?.apis?.[id] }])
        ),
        rarityPower: stored?.rarityPower ?? DEFAULT_SETTINGS.rarityPower,
        fullAt: {
            burst: { ...DEFAULT_SETTINGS.fullAt.burst, ...stored?.fullAt?.burst },
            pageBurst: { ...DEFAULT_SETTINGS.fullAt.pageBurst, ...stored?.fullAt?.pageBurst },
            script: { ...DEFAULT_SETTINGS.fullAt.script, ...stored?.fullAt?.script },
            page: { ...DEFAULT_SETTINGS.fullAt.page, ...stored?.fullAt?.page },
        },
        bursts: { ...DEFAULT_SETTINGS.bursts, ...stored?.bursts },
        identifiers: { ...DEFAULT_SETTINGS.identifiers, ...stored?.identifiers },
    };
}
