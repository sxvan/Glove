<script lang="ts">
    // So the cards show the findings, not how they came about.
    import type { Snippet } from 'svelte';

    let { label, text, children }: { label: string; text: string; children: Snippet } = $props();

    const id = $props.id();

    const START = -60;
    const MARGIN = 8;

    let info = $state<HTMLElement>();
    let left = $state(START);
    let flip = $state(false);

    // Measured, so the tip's size and its distance from the icon are set in one place (see .tip).
    function place() {
        const tip = info?.querySelector<HTMLElement>('.tip');
        if (!info || !tip) return;
        const icon = info.getBoundingClientRect();
        const { width, height } = tip.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(info).getPropertyValue('--gap'));
        left = Math.min(Math.max(START, MARGIN - icon.left), window.innerWidth - MARGIN - width - icon.left);
        flip = icon.bottom + gap + height > window.innerHeight - MARGIN && icon.top - gap - height > MARGIN;
    }
</script>

<span class="info" bind:this={info}>
    <button type="button" aria-label={label} aria-describedby={id} onpointerenter={place} onfocus={place}>
        {@render children()}
    </button>
    <span class="tip" class:above={flip} role="tooltip" {id} style:left="{left}px">{text}</span>
</span>

<style>
    .info {
        --gap: 6px;
        position: relative;
        display: inline-flex;
        vertical-align: middle;
    }

    /* Around the given icon: no room of its own, so the icon stays where it was, in its own color. */
    button {
        display: inline-flex;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: inherit;
        cursor: help;
    }

    button:hover,
    button:focus-visible {
        color: var(--text);
    }

    .tip {
        position: absolute;
        top: calc(100% + var(--gap));
        z-index: 10;
        width: 270px;
        padding: 9px 11px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--tooltip-bg);
        color: var(--text);
        box-shadow: 0 6px 24px var(--shadow);
        font-size: 12px;
        font-weight: 400;
        line-height: 1.45;
        visibility: hidden;
        opacity: 0;
        transition: opacity 0.12s ease;
        /* Clicks go through to the card underneath, e.g. while the tip stays open after focusing the icon. */
        pointer-events: none;
    }

    .tip.above {
        top: auto;
        bottom: calc(100% + var(--gap));
    }

    .info:hover .tip,
    .info:focus-within .tip {
        visibility: visible;
        opacity: 1;
    }
</style>
