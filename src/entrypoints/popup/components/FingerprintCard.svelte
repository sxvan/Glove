<script lang="ts">
    // A card for a script, or for the page as a whole (all its scripts together): its name and who
    // serves it beside the score, then what it read, signs of fingerprinting, and where it sent data.
    import { viewerUrl } from '@/lib/script-viewer';
    import type { ScriptDetail } from '../model';
    import { statements } from '../statements';
    import LikelihoodLabel from './LikelihoodLabel.svelte';
    import MiddleTruncate from './MiddleTruncate.svelte';
    import ScoreRing from './ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';
    import SignalLine from './SignalLine.svelte';

    // With `onOpen`, the whole card opens a screen about it and nothing in it is clickable on its
    // own: on the overview, the page's card leads to the fingerprinting screen. `onDetails` opens
    // the script's page at the section of a statement (by its key). As `headOnly`, only the head
    // and the score's breakdown: the script's page shows the statements in sections of their own.
    let {
        script,
        onOpen,
        onDetails,
        headOnly = false,
    }: { script: ScriptDetail; onOpen?: () => void; onDetails?: (section: string) => void; headOnly?: boolean } = $props();

    // Whether the signals the score was combined from show.
    let breakdown = $state(false);

</script>

<svelte:element
    this={onOpen ? 'div' : 'article'}
    class="card sleek"
    class:opens={onOpen}
    role={onOpen ? 'button' : undefined}
    tabindex={onOpen ? 0 : undefined}
    onclick={onOpen}
    onkeydown={(event: KeyboardEvent) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onOpen();
        }
    }}
>
    <!-- The name over who serves it, beside the score ring over the likelihood. -->
    <div class="head">
        <div class="who">
            {#if onOpen}
                <span class="name">{script.name}</span>
            {:else if script.viewer}
                <a class="name link" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer">
                    <MiddleTruncate text={script.name} path={script.path} />
                </a>
            {:else}
                <span class="name" title={script.url}><MiddleTruncate text={script.name} path={script.path} /></span>
            {/if}
            <!-- Who really serves it; how a CNAME-cloaked script hides is an info line, and the tooltip. -->
            <span class="origin" title={script.originTitle}>{script.origin}</span>
        </div>
        {#if onOpen}
            <div class="rating">
                <ScoreRing value={script.score} color="var(--{script.likelihood})" scale={100} empty={script.likelihood === 'unknown'} title="Score {Math.round(script.score * 100)}" />
                <LikelihoodLabel likelihood={script.likelihood} />
            </div>
            <!-- Like the overview's other cards: the card leads on to a screen. -->
            <span class="opens-chevron" aria-hidden="true"></span>
        {:else}
        <!-- Opens what the score was combined from (the chevron after the likelihood says it can). -->
        <button
            type="button"
            class="rating"
            aria-expanded={breakdown}
            disabled={script.tree.length === 0}
            title={breakdown ? 'Hide how the score came about' : 'Show how the score came about'}
            onclick={() => (breakdown = !breakdown)}
        >
            <ScoreRing value={script.score} color="var(--{script.likelihood})" scale={100} empty={script.likelihood === 'unknown'} title="Score {Math.round(script.score * 100)}" />
            <span class="likelihood">
                <LikelihoodLabel likelihood={script.likelihood} />
                <!-- In a box as wide as the info lines' chevron buttons, so the chevrons line up down the card. -->
                {#if script.tree.length > 0}<span class="chevron-box" aria-hidden="true"><span class="chevron" class:open={breakdown}></span></span>{/if}
            </span>
        </button>
        {/if}
    </div>

    {#if breakdown}
        <ScoreTree nodes={script.tree} />
    {/if}

    {#if !headOnly}
    <ul class="statements">
        {#each statements(script) as statement (statement.key)}
            <SignalLine
                text={statement.text}
                tone="info"
                detail={statement.detail}
                lead
                details={!onOpen && !!onDetails}
                onDetails={onDetails ? () => onDetails(statement.key) : undefined}
            />
        {/each}
    </ul>
    {/if}
</svelte:element>

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

    .likelihood {
        display: inline-flex;
        align-items: center;
    }

    /* As wide as the info lines' chevron buttons (see SignalLine), the chevron in its middle. */
    .chevron-box {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
    }

    /* Points down while the breakdown is closed, up while it is open; muted, so the likelihood
       keeps its color to itself. The size of the card's other chevrons: they differ in direction. */
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

    .rating:hover .chevron {
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

    /* A card opening a screen as a whole. */
    .opens {
        cursor: pointer;
    }

    /* The head gets a column for the chevron, after the rating. */
    .opens .head {
        grid-template-columns: minmax(0, 1fr) auto auto;
    }

    /* The same chevron as the overview's other cards, and as the info lines'. */
    .opens-chevron {
        width: 6px;
        height: 6px;
        margin-left: -3px;
        border-right: 1.5px solid var(--muted);
        border-bottom: 1.5px solid var(--muted);
        transform: rotate(-45deg);
    }

    /* The script's identity, next to its file name: in the text color, not toned down. */
    .origin {
        min-width: 0;
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
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
