<script lang="ts">
    // A settings section's title, with a button that resets the section to its defaults while it
    // differs from them (`changed`).
    let { title, changed = false, onreset }: { title: string; changed?: boolean; onreset?: () => void } = $props();
</script>

<div class="head">
    <h2>{title}</h2>
    {#if changed && onreset}
        <button type="button" title="Set this section's settings back to their defaults" onclick={onreset}>Reset</button>
    {/if}
</div>

<style>
    .head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        margin: 0 0 4px;
    }

    h2 {
        margin: 0;
        font-size: 15px;
    }

    /* Like the page's other buttons, but small: it belongs to its section. */
    button {
        padding: 3px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    button:hover {
        border-color: var(--muted);
    }
</style>
