<script lang="ts">
    import { untrack } from 'svelte';
    import type { ScoreNode } from '../model';
    import { nodeColor, shareSegments } from '../signal-colors';
    import MiddleTruncate from './MiddleTruncate.svelte';
    import ScoreRing from './ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';

    // The signals a score was combined from, each with how strongly it was observed (its ring) and its
    // share of the score above it (the shares of siblings add up to it). A signal made
    // from another score opens into that score's signals, e.g. a script's strongest burst into the
    // burst's, and a signal made from the APIs read into those APIs. An API opens into the factors
    // its value is the product of, its bits and its rarity weight, which have no share of their own.
    // Each row hangs off a guide on the left (see .tree), from the row it is under or, at the top,
    // from the score the tree is of. With `openStrongest`, the row adding the most that opens is
    // open at first, one level, so the tree shows that its rows open.
    let { nodes, openStrongest = false }: { nodes: ScoreNode[]; openStrongest?: boolean } = $props();

    // Only at first: as the score updates, rows stay as the user left them.
    let open = $state<Record<string, boolean>>(
        untrack(() => {
            const strongest = openStrongest
                ? [...nodes].filter((node) => node.children.length > 0).sort((a, b) => b.shownShare - a.shownShare)[0]
                : undefined;
            return strongest && strongest.shownShare > 0 ? { [strongest.key]: true } : {};
        })
    );

    // A list of APIs can be long (40 and more), so only those adding the most show at first.
    const SHOWN_APIS = 5;
    let showAll = $state(false);
    const isApiList = $derived(nodes.length > 0 && nodes.every((node) => node.api));
    const hidden = $derived(isApiList && !showAll ? Math.max(0, nodes.length - SHOWN_APIS) : 0);
    const shownNodes = $derived(hidden > 0 ? nodes.slice(0, SHOWN_APIS) : nodes);

    // A row made of signals shows their colors in its ring; one made of APIs or factors keeps its own color.
    const segmentsOf = (node: ScoreNode) => {
        const signals = node.children.filter((child) => !child.api && !child.factor);
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
        <li class:idle={node.shownShare === 0 && !node.factor}>
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
                <ScoreRing value={node.value} points={node.points} color={nodeColor(node)} segments={segmentsOf(node)} text={node.ringText} title={ringTitle(node)} />
                <!-- A factor multiplies into its parent: no share of its own, but its room. -->
                {#if node.factor}
                    <span class="share"></span>
                {:else}
                    <span class="share" class:none={node.shownShare === 0} title="What it adds to the {node.shareTo}'s score">
                        +{Math.round(node.shownShare * 100)}
                    </span>
                {/if}
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
    {#if isApiList && nodes.length > SHOWN_APIS}
        <li>
            <button type="button" class="more" class:open={showAll} onclick={() => (showAll = !showAll)}>
                {showAll ? 'Show less' : `Show ${hidden} more`}
            </button>
        </li>
    {/if}
</ul>

<style>
    /* The tree's measures, which its layout and its lines share: the space between rows, the room
       inside a row (above and below it, and before its chevron), the chevron's size, the space
       between a row's columns, and how far the rows are in from the guide. */
    .tree {
        --gap: 6px;
        --room-y: 4px;
        --room: 6px;
        --chevron: 12px;
        --columns-gap: 12px;
        --indent: 8px;
        --tree-line: color-mix(in srgb, var(--muted) 22%, transparent);
        --tree-marker: var(--muted);
    }

    /* Indented at every level, the guide under the parent row's chevron (its room, then the middle
       of its chevron), or at the top under the score the tree is of. */
    .tree {
        display: grid;
        gap: var(--gap);
        margin: 0 0 0 calc(var(--room) + var(--chevron) / 2);
        padding: 0 0 0 var(--indent);
        list-style: none;
    }

    /* Chevron | label and detail | ring with how strongly it was observed | share of the score above:
       each as wide as it is, the text taking the rest. */
    .row {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--columns-gap);
        width: 100%;
        /* Room inside, so its highlight on hover doesn't end at its chevron and its share; on the
           right, so the shares end where the chevron of "How the score came about" above does. */
        padding: var(--room-y) 14px var(--room-y) var(--room);
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
    }

    /* A row that opens says so on hover: it lights up in the fill color, like the card's "How the
       score came about" row. */
    button.row {
        border-radius: 8px;
        cursor: pointer;
    }

    button.row:hover {
        background: var(--fill);
    }

    /* A disclosure chevron, as in file trees: pointing right while closed, down while open; the
       size of the card's other chevrons. Rows that don't open have none. Its column is the row's
       full height, for the guide below it. */
    .toggle {
        position: relative;
        align-self: stretch;
        width: var(--chevron);
    }

    button.row .toggle::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 6px;
        height: 6px;
        border-right: 1.5px solid var(--tree-marker);
        border-bottom: 1.5px solid var(--tree-marker);
        transform: translate(-70%, -50%) rotate(-45deg);
    }

    button.row .toggle.open::before {
        transform: translate(-50%, -70%) rotate(45deg);
    }

    /* Once open, the guide starts under the chevron: down to the end of the row, through its room
       below, where the children's guide goes on. */
    .toggle.open::after {
        content: '';
        position: absolute;
        top: calc(50% + var(--chevron) / 2);
        bottom: calc(-1 * var(--room-y));
        left: calc(var(--chevron) / 2);
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


    /* Its share of the score above: secondary to how strongly it was observed. Room for the widest,
       "+100", so the rings line up at every level of the tree. */
    .share {
        min-width: 4ch;
        color: var(--muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    .share.none {
        opacity: 0.6;
    }

    /* Show more / show less under a list of APIs, lined up with their names: an action, not data,
       so grey with a tint of the accent and a chevron pointing where the list goes (down to
       expand, up to collapse), but quiet; in full on hover. */
    .more {
        position: relative;
        margin-left: calc(var(--room) + var(--chevron) + var(--columns-gap));
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

    /* Rows adding nothing to their parent, at the bottom: still there, but quieter; not the tree's
       lines, which the row draws. */
    .idle > .row > * {
        opacity: 0.55;
    }

    /* Signals of the score a signal was made from, under the row: its tree indents them. */
    .children {
        margin: 6px 0 8px;
    }

    /* Tree lines: a guide down from the parent's chevron through the gaps between rows, and an
       elbow into each row at its middle, up to its chevron; the last row's guide ends at its elbow.
       The elbow is drawn from the row (or "Show more"), so it is at the middle whatever the row's
       height; it starts a gap above, so it also closes the gap to the row before. */
    .tree > li {
        position: relative;
    }

    .tree > li:not(:last-child)::before,
    .tree > li > :first-child::before {
        content: '';
        position: absolute;
        border-color: var(--tree-line);
        border-style: solid;
        border-width: 0;
        pointer-events: none;
    }

    .tree > li:not(:last-child)::before {
        top: 0;
        bottom: 0;
        left: calc(-1 * var(--indent));
        border-left-width: 1px;
    }

    .tree > li > :first-child::before {
        top: calc(-1 * var(--gap));
        bottom: 50%;
        left: calc(-1 * var(--indent));
        width: calc(var(--indent) + var(--room) + 1px);
        border-bottom-width: 1px;
        border-left-width: 1px;
    }

    /* A row without a chevron: the elbow goes on through its empty column. */
    .tree > li > .leaf::before {
        width: calc(var(--indent) + var(--room) + var(--chevron));
    }

    /* "Show more" begins at the names: the elbow reaches back to the guide, and ends a little
       before the text. */
    .tree > li > .more::before {
        left: calc(-1 * (var(--indent) + var(--room) + var(--chevron) + var(--columns-gap)));
        width: calc(var(--indent) + var(--room) + var(--chevron) + var(--columns-gap) / 2);
    }
</style>
