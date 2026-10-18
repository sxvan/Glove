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
import { FP_APIS, FP_APIS_BY_ID, readKey } from './fp-apis';

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
            label: 'Identifying fingerprinting APIs',
            description:
                'How much identifying information the burst reads: the bits of the different fingerprinting APIs it reads, added up. Those revealing the same information count once, and of those that overlap, such as screen and window sizes, the strongest counts fully and the others what they add.',
            strength: 0.3,
        },
        unusualApis: {
            label: 'Unusual fingerprinting APIs',
            description:
                'How many fingerprinting APIs the burst reads that ordinary code rarely needs: their rarity added up, rare ones counting more. Reading them shows intent even when they reveal little.',
            strength: 0.85,
        },
        generatedCode: {
            label: 'Fingerprinting APIs from generated code',
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
        identifying: {
            label: 'Identifying fingerprinting APIs',
            description:
                'How much identifying information the script adds beyond its strongest burst, on top of what that burst revealed: the APIs it read outside the burst, each counting what it reveals beyond what is already known (nothing for a value already read, what it adds beside an overlapping API). Measured as how much of the way to the full 33 bits it covers, so once the burst reached them nothing adds. A fallback for collecting spread out or split into several bursts.',
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
        generatedCode: {
            label: 'Fingerprinting APIs from generated code',
            description:
                'How many unusual fingerprinting APIs beyond its strongest burst the script reads in code it generates at runtime (new Function, eval), which hides what it does.',
            strength: 0.5,
        },
    },
    // The page in two parts, each API counted in one only: its strongest script in full, and the
    // other scripts on top of it, scored like a script: their strongest burst, and what they read
    // beyond it (see computeDocumentFpScore).
    page: {
        strongestScript: { label: 'Strongest script', description: 'The score of the most suspicious script, counted in full.', strength: 1 },
        otherScripts: {
            label: 'Other scripts',
            description: 'What the other scripts read, on top of the strongest script: catches collecting split over several scripts.',
            strength: 1,
        },
    },
    otherScripts: {
        strongestBurst: {
            label: 'Strongest burst',
            description:
                'The score of the most suspicious burst of calls of the other scripts, on top of the strongest script: what they read together in one go beyond what it read.',
            strength: 0.3,
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
        identifying: {
            label: 'Identifying fingerprinting APIs',
            description:
                'How much identifying information the other scripts add outside their strongest burst, on top of what the strongest script and the burst revealed, counted as for a script (nothing for a value already read, what it adds beside an overlapping API, toward the full 33 bits). Weak: ordinary pages also read a fair amount through their many scripts.',
            strength: 0.15,
        },
        unusualApis: {
            label: 'Unusual fingerprinting APIs',
            description:
                'How many fingerprinting APIs the other scripts read outside their strongest burst that ordinary code rarely needs, beyond those the strongest script and the burst read: their rarity added up, rare ones counting more.',
            strength: 0.3,
        },
        onePlace: {
            label: 'Fingerprinting APIs from one place',
            description:
                'How many unusual fingerprinting APIs one of the other scripts reads from a single place in its code outside their strongest burst, beyond those the strongest script and the burst read, counted like "Unusual fingerprinting APIs".',
            strength: 0.6,
        },
        generatedCode: {
            label: 'Fingerprinting APIs from generated code',
            description: 'The most unusual fingerprinting APIs one of the other scripts reads outside their strongest burst in code generated at runtime (new Function, eval).',
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
    page: { strongestScript: 'script', otherScripts: 'otherScripts' },
    otherScripts: { strongestBurst: 'burst', beyondBurst: 'otherScriptsBeyondBurst' },
    otherScriptsBeyondBurst: { identifying: 'apis', unusualApis: 'apis', onePlace: 'apis', generatedCode: 'apis' },
    script: { strongestBurst: 'burst', beyondBurst: 'scriptBeyondBurst' },
    scriptBeyondBurst: { identifying: 'apis', unusualApis: 'apis', onePlace: 'apis', generatedCode: 'apis' },
    burst: { identifying: 'apis', unusualApis: 'apis', generatedCode: 'apis', onePlace: 'apis', dataSent: 'request' },
};

export const LEVEL_LABELS: Record<ScoreLevel, string> = {
    page: 'Page',
    otherScripts: 'Other scripts',
    otherScriptsBeyondBurst: 'Other scripts outside their burst',
    script: 'Script',
    scriptBeyondBurst: 'Script outside its burst',
    burst: 'Burst of calls',
    request: 'Request after a burst',
    hostname: 'ID-like hostname',
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

/** Where the API signals count as full (value 1): the added-up bits and rarity. */
export interface ApisFullAt {
    identifying: number;
    unusual: number;
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
    cutoffs: { fingerprinting: Cutoffs; hostname: Cutoffs };
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
}

export const DEFAULT_SETTINGS: ScoringSettings = {
    strengths: Object.fromEntries(
        Object.entries(SIGNALS).map(([level, signals]) => [level, Object.fromEntries(Object.entries(signals).map(([key, s]) => [key, s.strength]))])
    ) as ScoringSettings['strengths'],
    cutoffs: {
        // From 30, analytics and bot checks collecting device details (Dynatrace, reCAPTCHA, about 35 to
        // 39) are Possible together; known collectors score 80 and more, ordinary heavy scripts
        // (YouTube, video players) up to 64. Bing's ad tag (24) reads device details and the
        // automation check, which a large part of the web reads (see navigator.webdriver).
        fingerprinting: { possible: 0.3, likely: 0.75 },
        hostname: { possible: 0.3, likely: 0.6 },
    },
    apis: Object.fromEntries(FP_APIS.map((api) => [api.id, { bits: api.bits, adds: api.overlap?.adds ?? api.bits, rarity: api.rarity }])),
    rarityPower: 4,
    // Identifying information is full at 33 bits on every level: the bits that tell apart one
    // browser among everyone online (about 5 billion people, 2^33 = 8.6 billion), however the
    // collecting was done. Added up with overlapping APIs counting what they add (see apisSums); the
    // sum still overcounts somewhat, so full means "would be enough", not "identifies you".
    // Collectors read 35 to 73 bits in a burst (FingerprintJS 72, 135 counted without overlap),
    // ordinary scripts up to about 26 (analytics and players reading sizes, languages, time zone).
    //
    // Unusual APIs (rarities to rarityPower, added up) are full at 5 on every level: where no ordinary
    // script gets to any more. Of DuckDuckGo's Tracker Radar's 51,426 third-party scripts (US crawl,
    // 2026-10-09, each once), 99% of those reaching 3 and all reaching 4 are rated fingerprinting
    // (SEON, Forter, Incognia, Akamai's browserfp at 12 to 16), while below 3 ordinary scripts
    // appear; fingerprinters reach a median of 4.6. The crawl doesn't see the particular reads (the
    // graphics card name, hidden canvases, font probing), which add about 1 more, so 5 here.
    //
    // Beyond the strongest burst or script (see apisSumsBeyond) both count how much of the way to
    // full the rest still adds: once that reached full, nothing beyond adds to it.
    fullAt: {
        burst: { identifying: 33, unusual: 5 },
        // A burst of the other scripts: the same measures as a script's burst, so the same values.
        pageBurst: { identifying: 33, unusual: 5 },
        // A script outside its strongest burst.
        script: { identifying: 33, unusual: 5 },
        // The other scripts outside their strongest burst.
        page: { identifying: 33, unusual: 5 },
    },
    // Fingerprinters collect early and at once, pausing only for asynchronous APIs or to keep the
    // page responsive; measured collections took 13–362 ms with pauses up to 190 ms.
    bursts: { windowMs: 1000, minDistinctApis: 4, requestWindowMs: 1000 },
};

// ---------- limits ----------
// Where the other signals' values reach 1 ("full at"). Not user settings: they say what "a lot" means.

export const LIMITS = {
    request: { parameters: 5, bodyBytes: 4096 },
} as const;

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
        label: 'Requests right after',
        description: 'Requests with data a script makes up to this long after a burst count as sent right after reading. Collected data is often sent only after processing it (Kasada: 641 ms).',
        unit: 'ms',
    },
];

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
export function saturate(value: number, fullAt: number): number {
    return fullAt > 0 ? clamp01(value / fullAt) : 0;
}

/** What one API added to an API signal. */
export interface ApiAmount {
    id: string;
    /** Its bits or rarity, as set. */
    basis: number;
    /**
     * What it added: its bits (what it adds beyond an overlapping API, see overlapsWith), or the
     * rarity to rarityPower; 0 if an API with the same information counted instead.
     */
    amount: number;
    /** The API with the same information that counted instead of this one. */
    countedWith?: string;
    /** For bits: the API of its overlap group that counted all its bits, so this one only what it adds. */
    overlapsWith?: string;
    /** For a sum beyond known APIs (see apisSumsBeyond): whether countedWith or overlapsWith is one of those. */
    withKnown?: boolean;
}

/** An API signal's sum: its value from 0 to 1, the total it was made from and what each API added. */
export interface ApisSum {
    measure: 'bits' | 'rarity';
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
}

/**
 * The API signals' sums for the different APIs read, with what each API added (see ApisSum):
 * identifying information (Σ bits), how much they reveal, and unusual APIs (Σ rarity ^
 * rarityPower), how unusual it is to read them. The two are independent: the user agent reveals a
 * lot but everyone reads it, navigator.webdriver reveals nothing but checking it shows intent.
 *
 * APIs that reveal the same value (see FpApi.same, e.g. the WebGL and WebGL2 versions of a call,
 * or the pixels of a canvas exported in two formats) count once together, as the highest of them;
 * for unusual APIs so do both coordinates of a pair (see FpApi.pair), read together as one.
 * Of APIs whose values only overlap (see FpApi.overlap, e.g. the screen's and the window's sizes),
 * the one with the most bits counts all of them, the others only what they add beyond it.
 */
export function apisSums(distinctApis: Iterable<string>, level: ApisLevel, settings: ScoringSettings): { identifying: ApisSum; unusual: ApisSum } {
    const identifying = new SameSum('bits');
    const unusual = new SameSum('rarity');
    for (const id of distinctApis) {
        const traits = settings.apis[id];
        if (!traits) continue;
        const api = FP_APIS_BY_ID[id];
        const information = api?.same ?? id;
        const bits = nonNegative(traits.bits);
        const rarity = clamp01(traits.rarity);
        identifying.add(id, information, bits, bits, api?.overlap ? { group: api.overlap.group, adds: Math.min(bits, nonNegative(traits.adds)) } : undefined);
        // Both coordinates of a pair are one read (see readKey).
        unusual.add(id, readKey(id), rarity, rarity ** Math.max(0, settings.rarityPower));
    }
    const fullAt = settings.fullAt[level];
    return { identifying: identifying.sum(fullAt.identifying), unusual: unusual.sum(fullAt.unusual) };
}

/**
 * The API signals for what `distinctApis` add on top of `knownApis`, which are already counted
 * elsewhere: a script's beyond its strongest burst, a page's beyond its strongest script.
 *
 * Identifying information starts from the bits the known APIs reveal together (B), then adds the
 * others, the most bits first: one revealing a value already counted adds nothing (or what it has
 * more), one whose overlap group already has a counted API (known or added before) adds what it adds
 * beside it, any other its bits. Its value is how much of the way from B to fullAt they cover:
 * min(added, fullAt − B) / fullAt. Known APIs revealing fullAt bits already identify the browser,
 * so nothing beyond adds to that.
 *
 * Unusual APIs count each API's rarity as usual, except those whose read was already counted (the
 * same value, or the other coordinate of a pair).
 * Rarity is about intent, so overlapping values each count: reading another rare API shows more.
 * Its value is likewise how much of the way from the known APIs' rarities to fullAt they cover:
 * known APIs reading as unusually as no ordinary script does already show the intent.
 */
export function apisSumsBeyond(
    knownApis: Iterable<string>,
    distinctApis: Iterable<string>,
    level: ApisLevel,
    settings: ScoringSettings
): { identifying: ApisSum; unusual: ApisSum } {
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
    const unusual: ApiAmount[] = [];
    // For unusual APIs, what was read (see readKey): the known APIs' reads count as read.
    const reads = new Map([...known].filter((id) => settings.apis[id]).map((id) => [readKey(id), { id, known: true }]));
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

        const rarity = clamp01(traits.rarity);
        const read = readKey(id);
        const sameRead = reads.get(read);
        if (sameRead) unusual.push({ id, basis: rarity, amount: 0, countedWith: sameRead.id, withKnown: sameRead.known });
        else {
            unusual.push({ id, basis: rarity, amount: rarity ** Math.max(0, settings.rarityPower) });
            reads.set(read, { id, known: false });
        }
    }

    const byAmount = (a: ApiAmount, b: ApiAmount) => b.amount - a.amount || a.id.localeCompare(b.id);
    const addedBits = identifying.reduce((sum, api) => sum + api.amount, 0);
    const missing = Math.max(0, fullAt.identifying - base.total);
    const unusualTotal = unusual.reduce((sum, api) => sum + api.amount, 0);
    const unusualMissing = Math.max(0, fullAt.unusual - baseSums.unusual.total);
    return {
        identifying: {
            measure: 'bits',
            value: fullAt.identifying > 0 ? Math.min(addedBits, missing) / fullAt.identifying : 0,
            total: addedBits,
            fullAt: fullAt.identifying,
            known: base.total,
            apis: identifying.sort(byAmount),
        },
        unusual: {
            measure: 'rarity',
            value: fullAt.unusual > 0 ? Math.min(unusualTotal, unusualMissing) / fullAt.unusual : 0,
            total: unusualTotal,
            fullAt: fullAt.unusual,
            known: baseSums.unusual.total,
            apis: unusual.sort(byAmount),
        },
    };
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

/**
 * The version of the stored settings' units. 2: an API's identifying information in bits (see
 * ApiTraits), which version 1 (no version stored) kept as entropy from 0 to 1, bits divided by 8.
 */
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

/**
 * Settings stored in version 1's units, in version 2's: an API's entropy set as bits (×8). The
 * identifying information's full-at values are left out, as the sum they were set for counted
 * overlapping APIs fully; the new defaults apply.
 */
function migrated(stored: StoredSettings | undefined): StoredSettings | undefined {
    if (!stored || stored.version === SETTINGS_VERSION) return stored;
    const apis = Object.fromEntries(
        Object.entries(stored.apis ?? {}).map(([id, traits]) => {
            const { entropy, ...rest } = traits as Partial<ApiTraits> & { entropy?: number };
            return [id, entropy === undefined ? rest : { ...rest, bits: entropy * 8 }];
        })
    ) as ScoringSettings['apis'];
    const fullAt = Object.fromEntries(Object.entries(stored.fullAt ?? {}).map(([level, { identifying, ...rest }]) => [level, rest])) as ScoringSettings['fullAt'];
    return { ...stored, apis, fullAt, version: SETTINGS_VERSION };
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

/**
 * Strengths set for signals that have moved since, under their new level: the page's strongest
 * burst to the other scripts; the page's and the other scripts' API signals to the other scripts
 * outside their burst; a script's API signals to the script outside its burst.
 */
function movedStrengths(stored: StoredSettings | undefined, level: ScoreLevel): Record<string, number> {
    const strengths = (stored?.strengths ?? {}) as Partial<Record<string, Partial<Record<string, number>>>>;
    const pick = (from: string, keys: readonly string[]) =>
        Object.fromEntries(keys.filter((key) => strengths[from]?.[key] !== undefined).map((key) => [key, strengths[from]![key]!]));
    const API_SIGNALS = ['identifying', 'unusualApis', 'onePlace', 'generatedCode'] as const;
    if (level === 'otherScripts') return pick('page', ['strongestBurst']);
    if (level === 'otherScriptsBeyondBurst') return { ...pick('page', API_SIGNALS), ...pick('otherScripts', API_SIGNALS) };
    if (level === 'scriptBeyondBurst') return pick('script', API_SIGNALS);
    return {};
}

function withDefaults(storedAsIs: StoredSettings | undefined): ScoringSettings {
    const stored = migrated(storedAsIs);
    const strengths = Object.fromEntries(
        (Object.keys(DEFAULT_SETTINGS.strengths) as ScoreLevel[]).map((level) => [
            level,
            { ...DEFAULT_SETTINGS.strengths[level], ...movedStrengths(stored, level), ...stored?.strengths?.[level] },
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
            pageBurst: { ...DEFAULT_SETTINGS.fullAt.pageBurst, ...stored?.fullAt?.pageBurst },
            script: { ...DEFAULT_SETTINGS.fullAt.script, ...stored?.fullAt?.script },
            page: { ...DEFAULT_SETTINGS.fullAt.page, ...stored?.fullAt?.page },
        },
        bursts: { ...DEFAULT_SETTINGS.bursts, ...stored?.bursts },
    };
}
