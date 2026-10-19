<script lang="ts">
    // A settings section's title, with a button that resets the section to its defaults: always
    // there, so it is found where to look, and disabled while nothing differs from them (`changed`).
    // A section without defaults to go back to, such as a list of the user's choices, has none.
    let { title, changed = false, onreset }: { title: string; changed?: boolean; onreset?: () => void } = $props();
</script>

<div class="head">
    <h2>{title}</h2>
    {#if onreset}
        <button type="button" disabled={!changed} title={changed ? "Set this section's settings back to their defaults" : 'All at their defaults'} onclick={onreset}>
            Reset
        </button>
    {/if}
</div>

<style>
    /* The title and the button on one line, centered on each other. */
    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin: 0 0 4px;
    }

    h2 {
        margin: 0;
        font-size: 15px;
    }

    /* Like the page's other buttons, but small: it belongs to its section. Its height doesn't count
       toward the line's (its margin takes back what it is taller than the title), so a section's
       text sits the same with and without it. */
    button {
        margin-block: -4px;
        padding: 3px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 12px;
        line-height: 1.4;
        cursor: pointer;
    }

    button:hover:not(:disabled) {
        border-color: var(--muted);
    }

    button:disabled {
        color: var(--muted);
        opacity: 0.6;
        cursor: default;
    }
</style>
