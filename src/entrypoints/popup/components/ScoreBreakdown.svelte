<script lang="ts">
    import type { ScoreNode } from '../model';
    import { shareSegments } from '../signal-colors';
    import ScoreBar from './ScoreBar.svelte';
    import ScoreTree from './ScoreTree.svelte';

    // A score's bar; clicking it opens the signals the score was combined from.
    let { score, tree, label = 'Score' }: { score: number; tree: ScoreNode[]; label?: string } = $props();

    let open = $state(false);
</script>

<div class="breakdown">
    <button type="button" class="total" aria-expanded={open} disabled={tree.length === 0} onclick={() => (open = !open)}>
        <span class="label">{label}</span>
        <ScoreBar value={score} segments={shareSegments(tree)} title="{label} {score.toFixed(2)}" />
        <span class="number">{score.toFixed(2)}</span>
        <span class="toggle" class:open aria-hidden="true"></span>
    </button>
    {#if open}
        <div class="signals">
            <ScoreTree nodes={tree} />
        </div>
    {/if}
</div>

<style>
    /* Label | bar | score | toggle. */
    .total {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) 30px 10px;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 2px 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
    }

    .total:disabled {
        cursor: default;
    }

    .label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .total:not(:disabled):hover .label {
        color: var(--text);
    }

    .number {
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    .toggle {
        justify-self: end;
        width: 6px;
        height: 6px;
        border-right: 2px solid var(--muted);
        border-bottom: 2px solid var(--muted);
        transform: rotate(45deg) translate(-1px, -1px);
        transition: transform 0.1s;
    }

    .toggle.open {
        transform: rotate(-135deg) translate(-1px, -1px);
    }

    .total:disabled .toggle {
        visibility: hidden;
    }

    .signals {
        margin-top: 12px;
    }
</style>
