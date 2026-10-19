<script lang="ts">
    import type { Category } from '../model';
    import InfoTip from './InfoTip.svelte';
    import LikelihoodLabel from './LikelihoodLabel.svelte';

    // As `backOnly`, only the way back, without title, likelihood and explanation: for a screen
    // that shows them itself, like fingerprinting with its page score.
    let { category, onBack, backOnly = false }: { category: Category; onBack: () => void; backOnly?: boolean } = $props();
</script>

<div class="head">
    <button class="back" type="button" onclick={onBack}>
        <span class="arrow" aria-hidden="true"></span>Back
    </button>
    {#if !backOnly}
        <div class="title-row">
            <h2>{category.title} <InfoTip label="What is {category.title}?" text={category.explanation} /></h2>
            <LikelihoodLabel likelihood={category.likelihood} />
        </div>
    {/if}
</div>

<style>
    .back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        font-size: 12px;
        cursor: pointer;
    }

    .back:hover {
        color: var(--text);
    }

    .arrow {
        width: 6px;
        height: 6px;
        border-left: 2px solid currentColor;
        border-bottom: 2px solid currentColor;
        transform: rotate(45deg);
    }

    .title-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
    }

    h2 {
        margin: 0;
        font-size: 16px;
    }
</style>
