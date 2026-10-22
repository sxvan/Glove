<script lang="ts">
    // `details` gives it a column for the chevron, so lines with and without one keep the same width.
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

    /* Toned down, so it doesn't compete with the card's title. */
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

    .details {
        grid-template-columns: auto minmax(0, 1fr) auto;
    }
</style>
