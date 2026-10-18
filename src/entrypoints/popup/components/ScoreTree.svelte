<script lang="ts">
    import type { ScoreNode } from '../model';
    import { nodeColor, shareSegments } from '../signal-colors';
    import MiddleTruncate from './MiddleTruncate.svelte';
    import ScoreRing from './ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';

    // The signals a score was combined from, each with how strongly it was observed (its ring) and its
    // share of the score above it (the shares of siblings add up to it). A signal made
    // from another score opens into that score's signals, e.g. a script's strongest burst into the
    // burst's, and a signal made from the APIs read into those APIs.
    // Each row hangs off a guide on the left (see .tree), from the row it is under or, at the top,
    // from the score the tree is of.
    let { nodes }: { nodes: ScoreNode[] } = $props();

    let open = $state<Record<string, boolean>>({});

    // A list of APIs can be long (40 and more), so only those adding the most show at first.
    const SHOWN_APIS = 5;
    let showAll = $state(false);
    const isApiList = $derived(nodes.length > 0 && nodes.every((node) => node.api));
    const hidden = $derived(isApiList && !showAll ? Math.max(0, nodes.length - SHOWN_APIS) : 0);
    const shownNodes = $derived(hidden > 0 ? nodes.slice(0, SHOWN_APIS) : nodes);

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
    {#each shownNodes as node (node.key)}
        {@const expandable = node.children.length > 0}
        <li class:idle={node.shownShare === 0}>
            {#snippet row()}
                <span class="toggle" class:open={open[node.key]} aria-hidden="true"></span>
                <span class="text" title={node.api ? node.note : undefined}>
                    <span class="label" class:api={node.api} class:wrap={!node.detail} title={node.api ? undefined : node.label}>{node.label}</span>
                    {#if node.detailPath}
                        <span class="detail" title={node.detail}><MiddleTruncate text={node.detail} path plain /></span>
                    {:else if node.detail}
                        <span class="detail" title={node.detail}>{node.detail}</span>
                    {/if}
                </span>
                <!-- An API says what it adds in its detail (its bits or rarity); a ring would measure it
                     differently from the signals' rings, so its text takes the ring's place. -->
                {#if !node.api}
                    <ScoreRing value={node.value} points={node.points} color={nodeColor(node)} segments={segmentsOf(node)} scale={100} title={ringTitle(node)} />
                {/if}
                <span class="share" class:none={node.shownShare === 0} title="What it adds to the {node.shareTo}'s score">
                    +{Math.round(node.shownShare * 100)}
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
                <div class="row leaf" class:api={node.api}>{@render row()}</div>
            {/if}
        </li>
    {/each}
    {#if isApiList && nodes.length > SHOWN_APIS}
        <li>
            <button type="button" class="more" class:open={showAll} onclick={() => (showAll = !showAll)}>
                {showAll ? 'Show less' : `Show ${hidden} more`}
            </button>
        </li>
    {/if}
</ul>

<style>
    /* Indented by 14px at every level, the guide 6px in: under the parent row's chevron, or at
       the top under the score the tree is of. */
    .tree {
        display: grid;
        gap: 6px;
        margin: 0 0 0 6px;
        padding: 0 0 0 8px;
        list-style: none;
    }

    /* Chevron | label and detail | ring with how strongly it was observed | share of the score above. */
    .row {
        display: grid;
        grid-template-columns: 12px minmax(0, 1fr) 52px 78px;
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

    /* A disclosure chevron, as in file trees: pointing right while closed, down while open; the
       same thin chevron as after a card's likelihood. Rows that don't open have none. */
    .toggle {
        position: relative;
        width: 12px;
        height: 12px;
    }

    button.row .toggle::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 5px;
        height: 5px;
        border-right: 1.5px solid var(--tree-marker);
        border-bottom: 1.5px solid var(--tree-marker);
        transform: translate(-70%, -50%) rotate(-45deg);
    }

    button.row .toggle.open::before {
        transform: translate(-50%, -70%) rotate(45deg);
    }

    /* Once open, the guide starts under the chevron: down to the end of the row (60px tall, the
       chevron in its middle), where the children's guide goes on. */
    .toggle.open::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 6px;
        height: 24px;
        border-left: 1px solid var(--tree-line);
    }

    button.row:hover .toggle {
        --tree-marker: var(--text);
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

    /* Without a detail below it, a label may take two lines, shortened after the second. */
    .label.wrap {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        line-height: 1.3;
        white-space: normal;
    }

    /* Like a card's statements: in the body size, toned down between the text and the grey of a
       detail. */
    .label {
        color: color-mix(in srgb, var(--text) 70%, var(--muted));
        font-size: 14px;
        font-weight: 500;
    }

    .detail {
        color: var(--muted);
        font-size: 12px;
    }

    /* An API's name is code: in the detail size. */
    .label.api {
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 400;
    }

    /* An API's row has no ring: its name and detail run on into the ring's column. As tall as a
       row with a ring, so the tree lines meet it in the middle. */
    .row.api {
        grid-template-columns: 12px minmax(0, 1fr) 78px;
        min-height: 60px;
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
        font-size: 12px;
        line-height: 1.2;
        white-space: nowrap;
    }

    /* Show more / show less under a list of APIs, lined up with their names: an action, not data,
       so grey with a tint of the accent and a chevron pointing where the list goes (down to
       expand, up to collapse), but quiet; in full on hover. */
    .more {
        margin-left: 24px;
        padding: 2px 0;
        border: 0;
        background: none;
        color: color-mix(in srgb, var(--info) 45%, var(--muted));
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    .more::after {
        content: '';
        display: inline-block;
        width: 4px;
        height: 4px;
        margin-left: 6px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        vertical-align: 3px;
        transform: rotate(45deg);
    }

    .more.open::after {
        vertical-align: 0;
        transform: rotate(-135deg);
    }

    .more:hover {
        color: var(--info);
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    /* Rows adding nothing to their parent, at the bottom: still there, but quieter. */
    .idle > .row {
        opacity: 0.55;
    }

    /* Signals of the score a signal was made from, under the row: its tree indents them. */
    .children {
        margin: 6px 0 8px;
    }

    /* Tree lines: a guide down from the parent's chevron (6px into its row, its middle) through the
       6px gaps between rows, and an elbow into each row at its middle, up to its chevron (a row is
       60px: the 52px ring and 4px padding). The last row's guide ends at its elbow. */
    .tree > li {
        position: relative;
    }

    .tree > li::before,
    .tree > li::after {
        content: '';
        position: absolute;
        left: -8px;
        border-color: var(--tree-line);
        border-style: solid;
        border-width: 0;
        pointer-events: none;
    }

    .tree > li::before {
        top: -6px;
        bottom: 0;
        border-left-width: 1px;
    }

    .tree > li:last-child::before {
        bottom: auto;
        height: 36px;
    }

    .tree > li::after {
        top: 30px;
        width: 9px;
        border-top-width: 1px;
    }

    /* A row without a chevron: the elbow goes on through its empty column, up to the text. */
    .tree > li:has(> .leaf)::after {
        width: 18px;
    }

    /* "Show N more" under APIs is one short line: its elbow and the guide's end at its middle. */
    .tree > li:has(> .more)::before {
        height: 17px;
    }

    .tree > li:has(> .more)::after {
        top: 11px;
    }

    .tree {
        --tree-line: color-mix(in srgb, var(--muted) 22%, transparent);
        --tree-marker: color-mix(in srgb, var(--muted) 75%, transparent);
    }
</style>
