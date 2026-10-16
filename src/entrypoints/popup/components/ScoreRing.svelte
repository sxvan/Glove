<script lang="ts">
    import type { Segment } from '../signal-colors';

    // How strongly something was observed, as a ring with its value in the middle: closed at full
    // (value 1). With `points`, the inner ring fills up to where they count as full, and points beyond
    // that run on as a second lap in an outer ring, closed at twice full; so full always looks the
    // same. The filled part is in `color`, or split into `segments` (fractions of the filled part) to
    // show what it is made of.
    let {
        value,
        points,
        color = 'var(--muted)',
        segments = [],
        title,
    }: { value: number; points?: { total: number; fullAt: number }; color?: string; segments?: Segment[]; title: string } = $props();

    const clamp = (x: number) => Math.min(1, Math.max(0, x));

    const ratio = $derived(points && points.fullAt > 0 ? points.total / points.fullAt : clamp(value));
    const laps = $derived({ inner: clamp(ratio), outer: clamp(ratio - 1) });

    const SIZE = 52;
    const CENTER = SIZE / 2;
    const INNER = 18;
    const OUTER = 23.5;
    const circumference = (r: number) => 2 * Math.PI * r;

    // Between segments, so two colors never touch: next to each other, strong hues make one look
    // thicker than the other.
    const GAP = 1.5;

    // The arcs of the inner ring: one per segment, one after the other, together as long as its fill.
    const arcs = $derived.by(() => {
        const parts = segments.length > 0 ? segments : [{ fraction: 1, color }];
        const length = circumference(INNER) * laps.inner;
        const gap = parts.length > 1 ? GAP : 0;
        let start = 0;
        return parts.map((part) => {
            const arc = { color: part.color, length: Math.max(0, length * part.fraction - gap), start };
            start += length * part.fraction;
            return arc;
        });
    });
</script>

<span class="ring">
<svg viewBox="0 0 {SIZE} {SIZE}" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={clamp(value)} aria-label={title}>
    <title>{title}</title>
    <!-- Rings start at the top and fill clockwise. -->
    <g transform="rotate(-90 {CENTER} {CENTER})">
        <circle class="track" cx={CENTER} cy={CENTER} r={INNER} />
        {#each arcs as arc, i (i)}
            <circle cx={CENTER} cy={CENTER} r={INNER} stroke={arc.color} stroke-dasharray="{arc.length} {circumference(INNER)}" stroke-dashoffset={-arc.start} />
        {/each}
        {#if laps.outer > 0}
            <circle class="over" cx={CENTER} cy={CENTER} r={OUTER} stroke={color} stroke-dasharray="{circumference(OUTER) * laps.outer} {circumference(OUTER)}" />
        {/if}
    </g>
    <!-- The value, capped at full; the outer ring shows how far beyond full it went. -->
    <text class="value" x={CENTER} y={CENTER + 4}>{laps.inner.toFixed(2)}</text>
</svg>
<!-- The outer ring closes at twice full; beyond that, how many times full it is. -->
{#if ratio > 2}
    <span class="times squircle" aria-hidden="true">×{ratio.toFixed(1)}</span>
{/if}
</span>

<style>
    .ring {
        position: relative;
        display: block;
        width: 52px;
        height: 52px;
    }

    svg {
        display: block;
        width: 100%;
        height: 100%;
    }

    /* At the lower right, over the end of the outer ring. */
    .times {
        position: absolute;
        right: -6px;
        bottom: -2px;
        padding: 0 3px;
        border-radius: 6px;
        background: var(--surface);
        color: var(--muted);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        line-height: 14px;
    }

    circle {
        fill: none;
        stroke-width: 4;
    }

    .track {
        stroke: var(--border);
    }

    /* The second lap, past full: thinner and partly transparent, so it reads as extra beyond full
       rather than a new ring. */
    .over {
        stroke-width: 3;
        opacity: 0.5;
    }

    text {
        fill: var(--text);
        font-family: var(--font);
        font-variant-numeric: tabular-nums;
        text-anchor: middle;
    }

    .value {
        font-size: 11.5px;
        font-weight: 600;
    }
</style>
