<script lang="ts">
    // A card for a script, or for the page as a whole (all its scripts together).
    import { blockKey } from '@/lib/blocking';
    import { viewerUrl } from '@/lib/script-viewer';
    import type { ScriptDetail } from '@/ui/model';
    import { byTable, statements } from '../statements';
    import DetailsButton from '@/ui/components/DetailsButton.svelte';
    import BlockToggle from './BlockToggle.svelte';
    import LikelihoodLabel from '@/ui/components/LikelihoodLabel.svelte';
    import MiddleTruncate from '@/ui/components/MiddleTruncate.svelte';
    import ScoreRing from '@/ui/components/ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';
    import SignalLine from '@/ui/components/SignalLine.svelte';

    let { script, onDetails }: { script: ScriptDetail; onDetails?: (statement: string) => void } = $props();

    let breakdown = $state(false);

    // Only a script loaded from an address can be blocked; not the page as a whole, nor inline or
    // generated code.
    const blockable = $derived(script.path && blockKey(script.url) !== null);
</script>

<article class="card sleek">
    <div class="head">
        <div class="who">
            {#if script.viewer}
                <a class="name link" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer">
                    <MiddleTruncate text={script.name} path={script.path} />
                </a>
            {:else}
                <span class="name" title={script.url}><MiddleTruncate text={script.name} path={script.path} /></span>
            {/if}
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
    .sleek {
        display: grid;
        gap: 16px;
    }

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

    /* The size of the card's other chevrons, which differ only in direction. */
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

    .name {
        display: block;
        min-width: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .link {
        color: inherit;
        text-decoration: none;
        text-underline-offset: 3px;
    }

    .link:hover {
        text-decoration: underline;
    }

    .origin {
        min-width: 0;
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Lines leading to the same table, beside their one chevron, placed as an info line's. */
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

    .statements {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
</style>
