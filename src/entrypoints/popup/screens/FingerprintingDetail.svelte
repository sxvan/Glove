<script lang="ts">
    import FingerprintCard from '../components/FingerprintCard.svelte';
    import type { ScriptDetail } from '../model';

    // The page as a whole, then under a heading each script that read fingerprinting APIs, in the
    // same kind of card.
    let { page, scripts }: { page: ScriptDetail; scripts: ScriptDetail[] } = $props();
</script>

{#if scripts.length === 0}
    <p class="empty">No script on this page has read identifying device details so far.</p>
{:else}
    <FingerprintCard script={page} />
    <h3 class="scripts">Scripts <span class="count">{scripts.length}</span></h3>
{/if}

{#each scripts as script (script.key)}
    <FingerprintCard {script} />
{/each}

<style>
    /* Separates the page from its scripts' cards: a small heading over them. */
    .scripts {
        margin: 8px 0 -8px;
        font-size: 14px;
        font-weight: 600;
    }

    .count {
        margin-left: 4px;
        color: var(--muted);
        font-weight: 400;
    }

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
