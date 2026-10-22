import { type ApiAmount, type ApisSum, type ScoreLevel, SIGNAL_SOURCES, type SignalPart, SIGNALS } from '@/lib/scoring';
import type { DocumentSnapshot, MetricsSnapshot, ScriptSnapshot } from '@/types/snapshot';
import { amount, capitalize, duration, plural } from '../format';
import { strongest, strongestBurst } from './shared';
import { describeScript } from './urls';

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

export function pageTree(document: DocumentSnapshot, total: number): ScoreNode[] {
    return scoreTree('page', document.fpMetrics, total, (key) => {
        if (key === 'strongestScript') {
            const script = strongest(document.scripts, (script) => script.fpMetrics?.score ?? 0);
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
                    const burst = [...document.bursts].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0];
                    if (!burst) return null;
                    const detail = `${plural(burst.distinctFpApis.length, 'API')} within ${duration(burst.durationMs)}`;
                    return { detail, children: scoreTree('burst', burst, burst.score ?? 0) };
                }),
            };
        }
        return null;
    });
}

export function scriptTree(script: ScriptSnapshot): ScoreNode[] {
    return scoreTree('script', script.fpMetrics, script.fpMetrics?.score ?? 0, (key) => {
        if (key !== 'strongestBurst') return null;
        const burst = strongestBurst(script.bursts);
        if (!burst) return null;
        const detail = `${plural(burst.distinctFpApis.length, 'API')} within ${duration(burst.durationMs)}`;
        return { detail, children: scoreTree('burst', burst, burst.score ?? 0) };
    });
}

/**
 * The signals of a score, most contributing first (ties in the settings' order), sharing `total`.
 * A signal made from another score or from APIs has children sharing its own value in turn, so each
 * level adds up to its parent's ring. Signals combine as 1 − Π(1 − alone), which isn't a sum, so the
 * total is split as a waterfall: the strongest signal gets what it gives alone, each next one what it
 * adds on top of those before it. Signals switched off (strength 0) are left out. `expand` gives
 * what a signal made from another score was made from.
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

/** A score, share or signal value from 0 to 1 as shown, on the 0–100 scale of the score rings: 0.94 as 94. */
export function score(x: number): number {
    return Math.round(x * 100);
}

/**
 * A signal's name in the score tree: "fingerprinting" left out before APIs ("Identifying APIs", "Unusual APIs", "APIs
 * from one place"), as the tree is for those who look closer and has little room.
 */
function treeLabel(label: string): string {
    return capitalize(label.replace(/fingerprinting APIs/i, 'APIs'));
}

/** Short names of the signals made from APIs, for "+0.10 to unusual" under an API's share. */
const SHORT_NAMES: Record<string, string> = {
    rareIdentifying: 'rare identifying',
    onePlace: 'one place',
    generatedCode: 'generated',
};

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

/**
 * What an API's rare bits are made of, as rows under it: its bits (on its own, or what it adds beside
 * an overlapping API) on the signal's scale, and its rarity weight. Their rings multiply to its own.
 */
function rareFactors(api: ApiAmount, fullAt: number, power: number, number: (x: number) => number): ScoreNode[] {
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
            `Rarity ${number(rarity)} to the power ${number(power)}: ${number(weight)}, the share of its bits that counts.`
        ),
    ];
}

/** Where the APIs were read that a sum beyond what is already counted is measured on (see apisSumsBeyond). */
const KNOWN_WHERE: Partial<Record<ScoreLevel, string>> = {
    scriptBeyondBurst: 'read in the strongest burst',
    otherScriptsBeyondBurst: 'read by the strongest script or in the burst',
    burst: 'read by the strongest script',
};

/**
 * The APIs an API signal was made from, sharing the signal's value like signals share a score: as a
 * waterfall, from the API adding the most down, each adding its points relative to the full-at
 * (1 of 10 points is +0.10) until the signal is full; later ones add nothing beyond full. An API
 * whose information another API already counted adds nothing.
 */
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
            children: sum.measure === 'rareBits' ? rareFactors(api, sum.fullAt, sum.rarityPower ?? 0, number) : [],
        };
    });
    // Beyond what is already counted: "9 bits on top of 31, 2 of them toward 33".
    const detail =
        sum.known !== undefined
            ? `${number(sum.total)} ${unit} on top of ${number(sum.known)}, ${number(total * sum.fullAt)} of them toward ${number(sum.fullAt)}`
            : `${number(sum.total)} of ${number(sum.fullAt)} ${unit} from ${plural(sum.apis.length, 'API')}`;
    return { detail, children: withShownShares(children, total) };
}
