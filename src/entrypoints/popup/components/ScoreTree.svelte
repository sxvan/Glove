<script lang="ts">
    import type { ScoreNode } from '../model';
    import { nodeColor, shareSegments } from '../signal-colors';
    import ScoreRing from './ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';

    // The signals a score was combined from, each with how strongly it was observed (its ring) and its
    // share of the score above it (the shares of siblings add up to it). A signal made
    // from another score opens into that score's signals, e.g. a script's strongest burst into the
    // burst's, and a signal made from the APIs read into those APIs.
    let { nodes }: { nodes: ScoreNode[] } = $props();

    let open = $state<Record<string, boolean>>({});

    // A row made of signals shows their colors in its ring; one made of APIs keeps its own color.
    const segmentsOf = (node: ScoreNode) => {
        const signals = node.children.filter((child) => !child.api);
        return signals.length > 0 ? shareSegments(signals) : [];
    };

    // Points with one decimal, or two below 1 (e.g. 0.75), without trailing zeros.
    const points = (x: number) => String(+x.toFixed(x < 1 ? 2 : 1));
    const ringTitle = (node: ScoreNode) =>
        node.points ? `${points(node.points.total)} points, full at ${points(node.points.fullAt)}. ${node.note}` : node.note;
</script>

<ul class="tree">
    {#each nodes as node (node.key)}
        {@const expandable = node.children.length > 0}
        <li class:idle={node.shownShare === 0}>
            {#snippet row()}
                <span class="toggle" class:open={open[node.key]} aria-hidden="true"></span>
                <span class="text">
                    <span class="label" class:api={node.api} title={node.label}>{node.label}</span>
                    {#if node.detail}<span class="detail" title={node.detail}>{node.detail}</span>{/if}
                </span>
                <ScoreRing value={node.value} points={node.points} color={nodeColor(node)} segments={segmentsOf(node)} title={ringTitle(node)} />
                <span class="share" class:none={node.shownShare === 0} title="What it adds to the {node.shareTo}'s score">
                    +{node.shownShare.toFixed(2)}
                    <span class="to">to {node.shareTo}</span>
                </span>
            {/snippet}

            {#if expandable}
                <button type="button" class="row" aria-expanded={!!open[node.key]} onclick={() => (open[node.key] = !open[node.key])}>
                    {@render row()}
                </button>
                {#if open[node.key]}
                    <div class="children"><ScoreTree nodes={node.children} /></div>
                {/if}
            {:else}
                <div class="row leaf">{@render row()}</div>
            {/if}
        </li>
    {/each}
</ul>

<style>
    .tree {
        display: grid;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* Toggle | label and detail | ring with how strongly it was observed | share of the score above. */
    .row {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr) 52px 64px;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 4px 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
    }

    button.row {
        cursor: pointer;
    }

    button.row:hover .label {
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .toggle {
        width: 0;
        height: 0;
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        border-left: 5px solid var(--muted);
        transition: transform 0.1s;
    }

    .leaf .toggle {
        border: 0;
    }

    .toggle.open {
        transform: rotate(90deg);
    }

    .text {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    .label,
    .detail {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .detail {
        color: var(--muted);
        font-size: 11px;
    }

    .label.api {
        font-family: var(--mono);
        font-size: 11px;
    }

    /* Its share of the score above: secondary to how strongly it was observed. */
    .share {
        color: var(--muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    .share.none {
        opacity: 0.6;
    }

    /* Whose score the share goes to, under it. */
    .to {
        display: block;
        font-size: 10px;
        line-height: 1.2;
        white-space: nowrap;
    }

    /* Rows adding nothing to their parent, at the bottom: still there, but quieter. */
    .idle > .row {
        opacity: 0.55;
    }

    /* Signals of the score a signal was made from: indented a little, with a line for the depth. */
    .children {
        margin: 2px 0 6px 4px;
        padding-left: 10px;
        border-left: 1px solid var(--border);
    }
</style>
