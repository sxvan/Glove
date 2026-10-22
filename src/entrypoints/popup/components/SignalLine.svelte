<script lang="ts">
    // A line in a card's list of statements, with an icon for its tone: an info icon for a plain
    // fact ("Read 40 fingerprinting APIs"), a warning triangle for a sign of fingerprinting. With a
    // detail (text, or content such as a list of requests) below it. As `lead`, it is one of a card's
    // main statements: it stands out a little, also without a detail. With `onDetails`, a column on
    // the right holds a chevron, leading to a screen about the statement; `details` reserves that
    // column, so lines with and without it keep the same width. With an `explanation`, its icon shows
    // it as a tip (see InfoTip).
    import type { Snippet } from 'svelte';
    import type { TextPart } from '../text-parts';
    import DetailsButton from './DetailsButton.svelte';
    import InfoTip from './InfoTip.svelte';

    let {
        text,
        tone = 'warning',
        detail = '',
        explanation = '',
        lead = false,
        details = false,
        onDetails,
    }: {
        text: string | TextPart[];
        tone?: 'info' | 'warning';
        detail?: string;
        explanation?: string;
        lead?: boolean;
        details?: boolean;
        onDetails?: () => void;
    } = $props();

    const parts = $derived(typeof text === 'string' ? [text] : text);
</script>

<li class="signal tone-{tone}" class:lead class:details>
    {#if tone === 'info' && explanation}
        <InfoTip label="How is this measured?" text={explanation}>{@render infoIcon()}</InfoTip>
    {:else if tone === 'info'}
        {@render infoIcon()}
    {:else}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-label="Warning">
            <path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <path d="M8 6.2v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="8" cy="11.7" r="0.9" fill="currentColor" />
        </svg>
    {/if}
    <span class="text">
        {#each parts as part, i (i)}{#if typeof part === 'string'}{part}{:else}<span class="value">{part.value}</span>{/if}{/each}
        {#if detail}<span class="detail">{detail}</span>{/if}
    </span>
    {#if details}
        <DetailsButton onclick={onDetails} />
    {/if}
</li>

{#snippet infoIcon()}
    <svg viewBox="0 0 16 16" width="14" height="14" aria-label="Info">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4" />
        <path d="M8 7.2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
    </svg>
{/snippet}

<style>
    .signal {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        gap: 8px;
        font-size: 12px;
    }

    svg {
        margin-top: 1px;
    }

    /* One of a card's main statements: in the body size, but toned down between the text and the
       grey of a detail, so it doesn't compete with the card's title. */
    .lead .text {
        color: color-mix(in srgb, var(--text) 70%, var(--muted));
        font-size: 14px;
        font-weight: 500;
    }

    .lead svg {
        margin-top: 3px;
    }

    /* A value in the text (a count, a size, a site): emphasized, so lines are easy to scan. */
    .value {
        color: var(--text);
        font-weight: 600;
    }

    .detail {
        display: block;
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 400;
    }

    .tone-warning svg {
        color: var(--possible);
    }

    .tone-info svg {
        color: var(--info);
    }

    /* Icon | text | chevron. */
    .details {
        grid-template-columns: auto minmax(0, 1fr) auto;
    }
</style>
