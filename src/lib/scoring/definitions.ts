import { DEFAULT_IDENTIFIER_RULES, type IdentifierRules } from '../identifiers';
import { FP_APIS } from '../fp-apis';

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

export type SignalKey<L extends ScoreLevel> = keyof (typeof SIGNALS)[L] & string;

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

/** What counts as a burst of calls: one collection of details (see burst-detection). */
export interface BurstDetection {
    /** How long a burst is at most: the window that slides over the calls (see burst-detection). */
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
