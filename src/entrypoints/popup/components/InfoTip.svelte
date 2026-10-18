<script lang="ts">
    // An "i" icon that shows an explanation on hover or keyboard focus.
    // `above` keeps the tip inside the popup for icons near its bottom edge.
    let { label, text, above = false }: { label: string; text: string; above?: boolean } = $props();

    const id = $props.id();
</script>

<span class="info">
    <button type="button" aria-label={label} aria-describedby={id}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
            <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
            <path d="M8 7.2v4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
    </button>
    <span class="tip" class:above role="tooltip" {id}>{text}</span>
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

    button:hover,
    button:focus-visible {
        color: var(--text);
    }

    .tip {
        position: absolute;
        top: calc(100% + 6px);
        left: -60px;
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
