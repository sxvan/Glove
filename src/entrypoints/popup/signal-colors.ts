// Colors for the signals in score trees, the same at every level (a script's and a burst's
// "Unusual fingerprinting APIs" look alike), so a ring split into colors shows at a glance which
// signals a score comes from. Kept apart from the likelihood colors (green, orange, red). Bars and
// rings leave a small gap between colors, as strong hues side by side make one look thicker.
import type { ScoreNode } from './model';

const SIGNAL_COLORS: Record<string, string> = {
    identifying: '#60a5fa',
    unusualApis: '#a78bfa',
    generatedCode: '#2dd4bf',
    onePlace: '#f472b6',
    dataSent: '#facc15',
    // Signals standing for a whole score: calmer slate tones, as they sum up the signals below them.
    strongestScript: '#cbd5e1',
    strongestBurst: '#94a3b8',
    repeatedBursts: '#64748b',
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
 * What a ring or bar is made of: its direct children's shares, each in its color. Only the direct
 * children, so a ring always matches the rows right below it. A signal made from APIs keeps its own
 * color instead, as its APIs would be too many to tell apart.
 */
export function shareSegments(nodes: ScoreNode[]): Segment[] {
    const total = nodes.reduce((sum, node) => sum + node.share, 0);
    if (total <= 0) return [];

    // Neighbours of the same color merge into one segment.
    const segments: Segment[] = [];
    for (const node of nodes) {
        if (node.share <= 0) continue;
        const color = nodeColor(node);
        const last = segments[segments.length - 1];
        if (last && last.color === color) last.fraction += node.share / total;
        else segments.push({ fraction: node.share / total, color });
    }
    return segments;
}
