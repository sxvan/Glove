<script lang="ts">
    // A card for a script, or for the page as a whole (all its scripts together): its name and who
    // serves it beside the score, then what it read, signs of fingerprinting, and where it sent data;
    // last, for a script, the switch that blocks it.
    import { blockKey } from '@/lib/blocking';
    import { viewerUrl } from '@/lib/script-viewer';
    import type { ScriptDetail } from '../model';
    import { byTable, statements } from '../statements';
    import DetailsButton from './DetailsButton.svelte';
    import BlockToggle from './BlockToggle.svelte';
    import LikelihoodLabel from './LikelihoodLabel.svelte';
    import MiddleTruncate from './MiddleTruncate.svelte';
    import ScoreRing from './ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';
    import SignalLine from './SignalLine.svelte';

    // `onDetails` opens the details page at the table of a statement (by its key).
    let { script, onDetails }: { script: ScriptDetail; onDetails?: (statement: string) => void } = $props();

    // Whether the signals the score was combined from show.
    let breakdown = $state(false);

    // Only a script loaded from an address can be blocked; not the page as a whole, nor inline or
    // generated code.
    const blockable = $derived(script.path && blockKey(script.url) !== null);
</script>

<article class="card sleek">
    <!-- The name over who serves it, beside the score ring over the likelihood. -->
    <div class="head">
        <div class="who">
            {#if script.viewer}
                <a class="name link" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer">
                    <MiddleTruncate text={script.name} path={script.path} />
                </a>
            {:else}
                <span class="name" title={script.url}><MiddleTruncate text={script.name} path={script.path} /></span>
            {/if}
            <!-- Who really serves it; how a CNAME-cloaked script hides is an info line, and the tooltip. -->
            <!-- A host, when too long, is shortened in the middle, keeping its site at the end. -->
            <span class="origin" title={script.originTitle}>{#if script.path}<MiddleTruncate text={script.origin} />{:else}{script.origin}{/if}</span>
        </div>
        <!-- Also opens what the score was combined from, as the row below says it does. -->
        <button
            type="button"
            class="rating"
            aria-expanded={breakdown}
            disabled={script.tree.length === 0}
            title={breakdown ? 'Hide how the score came about' : 'Show how the score came about'}
            onclick={() => (breakdown = !breakdown)}
        >
            <ScoreRing value={script.score} color="var(--{script.likelihood})" empty={script.likelihood === 'unknown'} title="Score {Math.round(script.score * 100)}" />
            <LikelihoodLabel likelihood={script.likelihood} />
        </button>
    </div>

    <!-- What the score was combined from: a row that says so, as the ring alone wasn't seen to open it. -->
    {#if script.tree.length > 0}
        <button type="button" class="breakdown squircle" aria-expanded={breakdown} onclick={() => (breakdown = !breakdown)}>
            <span>How the score came about</span>
            <span class="chevron-box" aria-hidden="true"><span class="chevron" class:open={breakdown}></span></span>
        </button>
    {/if}
    {#if breakdown}
        <!-- Its strongest part open at first, showing that the parts open. -->
        <ScoreTree nodes={script.tree} openStrongest />
    {/if}

    <!-- Lines leading to the same table of the details page share one chevron, in their middle. -->
    <ul class="statements">
        {#each byTable(statements(script)) as lines (lines[0]!.key)}
            {@const details = !!onDetails}
            {@const open = onDetails ? () => onDetails(lines[0]!.key) : undefined}
            {#if lines.length === 1}
                {@const statement = lines[0]!}
                <SignalLine text={statement.text} tone="info" detail={statement.detail} explanation={statement.explanation} lead {details} onDetails={open} />
            {:else}
                <li class="joined" class:details>
                    <ul class="lines">
                        {#each lines as statement (statement.key)}
                            <SignalLine text={statement.text} tone="info" detail={statement.detail} explanation={statement.explanation} lead />
                        {/each}
                    </ul>
                    {#if details}<DetailsButton onclick={open} />{/if}
                </li>
            {/if}
        {/each}
    </ul>

    {#if blockable}
        <BlockToggle url={script.url} label="Block this script" />
    {/if}
</article>

<style>
    /* The parts of a card are separated by space only. */
    .sleek {
        display: grid;
        gap: 16px;
    }

    /* The name over who serves it, as one tight block, centered beside the score ring with its
       likelihood under it as a caption. The ring's column is narrow, so the name gets the width. */
    .head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
    }

    .who {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    .rating {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .rating:disabled {
        cursor: default;
    }

    /* A row in the fill color, like the API table's "everyday reads": its text, then its chevron, with
       room inside on both sides. */
    .breakdown {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 8px 8px 12px;
        border: 0;
        border-radius: 10px;
        background: var(--fill);
        color: color-mix(in srgb, var(--text) 70%, var(--muted));
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
    }

    .breakdown:hover {
        color: var(--text);
    }

    /* Open, a little more room before the tree, which starts under it. */
    .breakdown[aria-expanded='true'] {
        margin-bottom: 8px;
    }

    /* As wide as the info lines' chevron buttons (see SignalLine), the chevron in its middle. */
    .chevron-box {
        display: grid;
        place-items: center;
        width: var(--chevron-button);
        height: var(--chevron-button);
    }

    /* Points down while the breakdown is closed, up while it is open; muted, as the row's text is.
       The size of the card's other chevrons: they differ in direction. */
    .chevron {
        width: 6px;
        height: 6px;
        margin-top: -4px;
        border-right: 1.5px solid var(--muted);
        border-bottom: 1.5px solid var(--muted);
        transform: rotate(45deg);
    }

    .chevron.open {
        margin-top: 4px;
        transform: rotate(-135deg);
    }

    .breakdown:hover .chevron {
        border-color: var(--text);
    }

    /* One line, shortened in the middle when too long (see MiddleTruncate); the tooltip has the
       full URL. */
    .name {
        display: block;
        min-width: 0;
        font-size: 16px;
        font-weight: 600;
    }

    /* The title links to the script viewer; underlined on hover. */
    .link {
        color: inherit;
        text-decoration: none;
        text-underline-offset: 3px;
    }

    .link:hover {
        text-decoration: underline;
    }

    /* The script's identity, next to its file name: in the text color, not toned down. */
    .origin {
        min-width: 0;
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Lines that lead to the same table: one beside the other, with their chevron as an info line's. */
    .joined.details {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
    }

    .lines {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* What the card says about the script: facts and signs of fingerprinting, one per line. */
    .statements {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
</style>
