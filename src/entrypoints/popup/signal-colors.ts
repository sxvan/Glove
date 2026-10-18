// Colors for the signals in score trees, the same at every level (a script's and a burst's
// "Unusual fingerprinting APIs" look alike), so a ring split into colors shows at a glance which
// signals a score comes from. Kept apart from the likelihood colors (green, orange, red). Bars and
// rings leave a small gap between colors, as strong hues side by side make one look thicker.
import type { ScoreNode } from './model';

const SIGNAL_COLORS: Record<string, string> = {
    rareIdentifying: '#6366f1',
    generatedCode: '#14b8a6',
    onePlace: '#ec4899',
    dataSent: '#d4a106',
    cnameCloaked: '#0ea5e9',
    sentThroughAlias: '#0284c7',
    // Signals standing for a whole score: calmer slate tones, as they sum up the signals below them.
    strongestScript: '#94a3b8',
    strongestBurst: '#64748b',
};

/** The color of a node in a score tree; APIs and signals without their own color are grey. */
export function nodeColor(node: ScoreNode): string {
    return (!node.api && SIGNAL_COLORS[node.key]) || 'var(--muted)';
}

/** A part of a ring or bar: its fraction of the whole (fractions add up to 1) and its color. */
export interface Segment {
    fraction: number;
    color: string;
}

/**
 * What a ring or bar is made of: its direct children's shares, in their order and size, so a ring
 * matches the rows right below it. A child standing for a whole score (e.g. the strongest burst) is
 * drawn in the colors of what it is made of, so each color means the same signal at every level and
 * expanding a row shows no colors that weren't in the ring above it. A signal made from APIs keeps
 * its own color, as its APIs would be too many to tell apart.
 */
export function shareSegments(nodes: ScoreNode[]): Segment[] {
    const total = nodes.reduce((sum, node) => sum + Math.max(0, node.share), 0);
    if (total <= 0) return [];

    // Neighbours of the same color merge into one segment.
    const segments: Segment[] = [];
    const add = (fraction: number, color: string) => {
        const last = segments[segments.length - 1];
        if (last && last.color === color) last.fraction += fraction;
        else segments.push({ fraction, color });
    };
    for (const node of nodes) {
        if (node.share <= 0) continue;
        const fraction = node.share / total;
        const signals = node.api ? [] : node.children.filter((child) => !child.api);
        const parts = signals.length > 0 ? shareSegments(signals) : [];
        if (parts.length > 0) for (const part of parts) add(part.fraction * fraction, part.color);
        else add(fraction, nodeColor(node));
    }
    return segments;
}
