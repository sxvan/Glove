<script lang="ts">
    // An "i" icon that shows an explanation on hover or keyboard focus. Explanations live in these
    // tips, so the screens show the findings, not how they came about. When shown, the tip places
    // itself inside the popup: shifted sideways as needed, and above the icon when there is no room
    // below it; `above` puts it above always. With `children`, they are the icon instead of the
    // grey "i", e.g. an info line's own icon.
    import type { Snippet } from 'svelte';

    let { label, text, above = false, children }: { label: string; text: string; above?: boolean; children?: Snippet } = $props();

    const id = $props.id();

    // The tip's width (see .tip) and the room it keeps from the popup's edges.
    const TIP_WIDTH = 270;
    const MARGIN = 8;

    let info = $state<HTMLElement>();
    let left = $state(-60);
    let flip = $state(false);

    function place() {
        if (!info) return;
        const icon = info.getBoundingClientRect();
        const tipHeight = info.querySelector('.tip')?.getBoundingClientRect().height ?? 0;
        left = Math.min(Math.max(-60, MARGIN - icon.left), window.innerWidth - MARGIN - TIP_WIDTH - icon.left);
        flip = icon.bottom + 6 + tipHeight > window.innerHeight - MARGIN && icon.top - 6 - tipHeight > MARGIN;
    }
</script>

<span class="info" bind:this={info}>
    <button type="button" class:own={children} aria-label={label} aria-describedby={id} onpointerenter={place} onfocus={place}>
        {#if children}{@render children()}{:else}<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
            <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
            <path d="M8 7.2v4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>{/if}
    </button>
    <span class="tip" class:above={above || flip} role="tooltip" {id} style:left="{left}px">{text}</span>
</span>

<style>
    .info {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
    }

    button {
        display: inline-flex;
        padding: 2px;
        border: 0;
        border-radius: 50%;
        background: none;
        color: var(--muted);
        cursor: help;
    }

    /* Around a given icon: no room of its own, so the icon stays where it was, in its own color. */
    button.own {
        padding: 0;
        color: inherit;
    }

    button:hover,
    button:focus-visible {
        color: var(--text);
    }

    .tip {
        position: absolute;
        top: calc(100% + 6px);
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
        bottom: calc(100% + 6px);
    }

    .info:hover .tip,
    .info:focus-within .tip {
        visibility: visible;
        opacity: 1;
    }
</style>
