<script lang="ts">
    import { LIKELIHOOD_LABELS, type Category } from '../model';
    import InfoTip from './InfoTip.svelte';
    import LikelihoodLabel from './LikelihoodLabel.svelte';

    // tipAbove opens the explanation upwards, so it stays inside the popup for lower cards.
    let { category, tipAbove = false, onOpen }: { category: Category; tipAbove?: boolean; onOpen: () => void } = $props();
</script>

<!-- The open button stretches over the whole card; the info icon and score bars sit above it,
     since interactive elements can't be nested. -->
<div class="card category tone-{category.likelihood}">
    <div class="head">
        <span class="dot" aria-hidden="true"></span>
        <div class="title">
            <button class="open" type="button" onclick={onOpen}>{category.title}</button>
            <InfoTip label="What is {category.title}?" text={category.explanation} above={tipAbove} />
        </div>
        <LikelihoodLabel likelihood={category.likelihood} />
        <span class="chevron" aria-hidden="true"></span>
    </div>

    <p class="line">{category.summary}</p>

    {#if category.rows.length > 0}
        <ul class="rows">
            {#each category.rows as row (row.key)}
                <li>
                    <span class="name" title={row.title}>{row.name}</span>
                    <span class="detail" title={row.detail}>{row.detail}</span>
                    <!-- The score as a bar, in one color so the rows stay calm; the rating is in the tooltip. -->
                    {#if row.score !== null}
                        {@const score = Math.min(row.score, 1)}
                        <span
                            class="bar"
                            role="meter"
                            aria-valuemin={0}
                            aria-valuemax={1}
                            aria-valuenow={score}
                            aria-label="Score"
                            title="{row.likelihood ? LIKELIHOOD_LABELS[row.likelihood] : 'Score'} · {score.toFixed(2)}"
                        >
                            <span class="fill" style:width="{score * 100}%"></span>
                        </span>
                    {:else}
                        <span></span>
                    {/if}
                </li>
            {/each}
        </ul>
        {#if category.moreRows > 0}
            <p class="line">+{category.moreRows} more</p>
        {/if}
    {/if}
</div>

<style>
    .category {
        position: relative;
    }

    .category:hover {
        border-color: var(--muted);
    }

    .head {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        align-items: center;
        gap: 10px;
    }

    .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--color);
    }

    .title {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        font-weight: 600;
    }

    .open {
        padding: 0;
        border: 0;
        background: none;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
    }

    /* Makes the whole card clickable. */
    .open::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 12px;
    }

    .open:focus-visible {
        outline: none;
    }

    .open:focus-visible::after {
        outline: 2px solid var(--muted);
        outline-offset: 2px;
    }

    /* Keep the info icons above the stretched button, and the one showing its tip above the other
       cards' icons, which share the same layer and would otherwise paint over the tip. */
    .title :global(.info) {
        z-index: 1;
    }

    .title :global(.info:hover),
    .title :global(.info:focus-within) {
        z-index: 2;
    }

    .chevron {
        width: 7px;
        height: 7px;
        margin-left: 2px;
        border-right: 2px solid var(--muted);
        border-bottom: 2px solid var(--muted);
        transform: rotate(-45deg);
    }

    /* Body lines line up with the title, past the dot. */
    .line,
    .rows {
        margin: 4px 0 0 19px;
    }

    .line {
        color: var(--muted);
        font-size: 12px;
        overflow-wrap: anywhere;
    }

    .rows {
        display: grid;
        gap: 3px;
        padding: 6px 0 0;
        border-top: 1px solid var(--border);
        list-style: none;
    }

    li {
        display: grid;
        /* The name gets the room first; the host column takes what it needs, up to 40%. */
        grid-template-columns: minmax(0, 1fr) fit-content(40%) 48px;
        align-items: baseline;
        gap: 10px;
        font-size: 12px;
    }

    .name,
    .detail {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .name {
        font-family: var(--mono);
    }

    .detail {
        color: var(--muted);
        font-size: 11px;
    }

    .bar {
        position: relative;
        z-index: 1; /* above the card's stretched button, so its tooltip shows */
        align-self: center;
        height: 4px;
        border-radius: 2px;
        background: var(--border);
        overflow: hidden;
    }

    .fill {
        display: block;
        height: 100%;
        border-radius: 2px;
        background: var(--muted);
    }
</style>
