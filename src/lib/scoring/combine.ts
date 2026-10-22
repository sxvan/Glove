import { FP_APIS_BY_ID } from '../fp-apis';
import { DEFAULT_SETTINGS, type ApisLevel, type ScoreLevel, type ScoringSettings, type SignalKey, type SignalValues } from './definitions';

function combine<L extends ScoreLevel>(level: L, values: SignalValues<L>, settings: ScoringSettings): number {
    const strengths = settings.strengths[level];
    let remaining = 1;
    for (const key of Object.keys(values) as SignalKey<L>[]) {
        remaining *= 1 - clamp01(strengths[key]) * clamp01(values[key]);
    }
    return 1 - remaining;
}

/** What a signal contributes alone is strength × value. */
export interface SignalPart {
    value: number;
    strength: number;
    /** For a signal made from the APIs read: what each of them added (see apisSums). */
    apis?: ApisSum;
    /** For a signal that is itself a score of signals (the rest of a page). */
    parts?: Record<string, SignalPart>;
}

export interface ScoredParts {
    score: number;
    parts: Record<string, SignalPart>;
}

/** Like combine, but keeps each signal's part, to show how a score came about. */
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

function saturate(value: number, fullAt: number): number {
    return fullAt > 0 ? clamp01(value / fullAt) : 0;
}

export interface ApiAmount {
    id: string;
    /** Its bits, as set; for rare bits, the bits it counted (see amount for bits). */
    basis: number;
    /** 0 if an API with the same information counted instead (countedWith). */
    amount: number;
    countedWith?: string;
    /** For bits: the API of its overlap group that counted all its bits, so this one only what it adds. */
    overlapsWith?: string;
    /** For a sum beyond known APIs (see apisSumsBeyond): whether countedWith or overlapsWith is one of those. */
    withKnown?: boolean;
    /** For rare bits: weight is rarity to rarityPower, which the counted bits are multiplied by. */
    bits?: number;
    rarity?: number;
    weight?: number;
}

export interface ApisSum {
    measure: 'bits' | 'rareBits';
    value: number;
    total: number;
    fullAt: number;
    /** Beyond known APIs (see apisSumsBeyond): their bits; the value is then the share of what was missing to fullAt. */
    known?: number;
    /** Most added first. */
    apis: ApiAmount[];
    rarityPower?: number;
}

/**
 * APIs revealing the same value (FpApi.same) count once; of overlapping ones (FpApi.overlap) the one
 * with the most bits counts all, the others what they add. Rare bits weigh each by rarity, as reading
 * what ordinary code rarely needs shows intent: the user agent reveals a lot but everyone reads it,
 * navigator.webdriver is rarely read but reveals nothing, a hidden canvas is both.
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

// Bits that tell everyone apart: about 5 billion people are online, and 2^33 is 8.6 billion.
export const EVERYONE_BITS = 33;

/** The bits read are only shown; the rare bits score. */
export interface ApisSums {
    identifying: ApisSum;
    rareIdentifying: ApisSum;
}

/** Beyond `known` rare bits (see apisSumsBeyond), the value is how much of the way from them to fullAt these add. */
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
 * What `distinctApis` add on top of `knownApis`, counted elsewhere (a script's strongest burst, a
 * page's strongest script): toward fullAt from the known APIs' rare bits, as known APIs reaching full
 * already show what a fingerprinter collects.
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

export function rareAmounts(distinctApis: Iterable<string>, apis: ScoringSettings['apis'], rarityPower: number): Map<string, ApiAmount> {
    const sums = apisSums(distinctApis, 'page', { ...DEFAULT_SETTINGS, apis, rarityPower });
    return new Map(sums.rareIdentifying.apis.map((api) => [api.id, api]));
}

export function rareIdentifyingBits(distinctApis: Iterable<string>, apis: ScoringSettings['apis'], rarityPower: number): number {
    return apisSums(distinctApis, 'page', { ...DEFAULT_SETTINGS, apis, rarityPower }).rareIdentifying.total;
}

export function identifyingBits(distinctApis: Iterable<string>, apis: ScoringSettings['apis']): number {
    return apisSums(distinctApis, 'page', { ...DEFAULT_SETTINGS, apis }).identifying.total;
}

/** Each piece of information counts once, as the API adding the most for it. */
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
