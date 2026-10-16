<script lang="ts">
    import type { Segment } from '../signal-colors';

    // A score as a bar, in one color so lists stay calm, or split into `segments` (fractions of the
    // filled part) to show which signals it comes from.
    let { value, segments = [], title }: { value: number; segments?: Segment[]; title: string } = $props();

    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    const parts = $derived(segments.length > 0 ? segments : [{ fraction: 1, color: 'var(--muted)' }]);
</script>

<span class="bar" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={clamp(value)} aria-label={title} {title}>
    <span class="fill" style:width="{clamp(value) * 100}%">
        {#each parts as part, i (i)}
            <span style:width="{part.fraction * 100}%" style:background={part.color}></span>
        {/each}
    </span>
</span>

<style>
    .bar {
        display: block;
        height: 4px;
        border-radius: 2px;
        background: var(--border);
        overflow: hidden;
    }

    .fill {
        display: flex;
        height: 100%;
        border-radius: 2px;
        overflow: hidden;
    }

    .fill span {
        box-sizing: border-box;
        height: 100%;
    }

    /* A small gap between segments, so two colors never touch: next to each other, strong hues make
       one look thicker than the other. */
    .fill span + span {
        border-left: 1.5px solid var(--surface);
    }
</style>
