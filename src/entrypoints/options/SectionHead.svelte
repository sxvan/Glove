<script lang="ts">
    // Reset is always there, so it is found where to look, and disabled while nothing differs.
    let { title, changed = false, onreset }: { title: string; changed?: boolean; onreset?: () => void } = $props();
</script>

<div class="head">
    <h2>{title}</h2>
    {#if onreset}
        <button type="button" class="button" disabled={!changed} title={changed ? "Set this section's settings back to their defaults" : 'All at their defaults'} onclick={onreset}>
            Reset
        </button>
    {/if}
</div>

<style>
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

    /* Small, as it belongs to its section. Its height doesn't count toward the line's (its margin
       takes back what it is taller than the title), so a section's text sits the same with and
       without it. */
    button {
        margin-block: -4px;
        padding: 3px 10px;
        line-height: 1.4;
    }
</style>
