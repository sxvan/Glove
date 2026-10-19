<script lang="ts">
    import BlockToggle from '../components/BlockToggle.svelte';
    import FingerprintCard from '../components/FingerprintCard.svelte';
    import MiddleTruncate from '../components/MiddleTruncate.svelte';
    import { plural } from '../format';
    import type { BlockedDetail, ScriptDetail } from '../model';

    // The page as a whole, then under a heading each script that read fingerprinting APIs, in the
    // same kind of card; first among them the blocked scripts that tried to load, to unblock them.
    // `onDetails` opens a script's page (by its key) at a section.
    let {
        page,
        scripts,
        blocked,
        onDetails,
    }: { page: ScriptDetail; scripts: ScriptDetail[]; blocked: BlockedDetail[]; onDetails: (key: string, section: string) => void } = $props();
</script>

{#if scripts.length === 0}
    <p class="empty">No script on this page has read identifying device details so far.</p>
{:else}
    <FingerprintCard script={page} onDetails={(section) => onDetails(page.key, section)} />
{/if}
{#if scripts.length + blocked.length > 0}
    <h3 class="scripts">Scripts <span class="count">{scripts.length + blocked.length}</span></h3>
{/if}

{#each blocked as script (script.key)}
    <article class="card blocked">
        <div class="who">
            <span class="name" title={script.url}><MiddleTruncate text={script.name} path /></span>
            <span class="origin"><MiddleTruncate text={script.origin} /></span>
        </div>
        <BlockToggle url={script.url} label="Block this script" detail={script.attempts === 1 ? 'Tried to load once' : `Tried to load ${plural(script.attempts, 'time')}`} />
    </article>
{/each}

{#each scripts as script (script.key)}
    <FingerprintCard {script} onDetails={(section) => onDetails(script.key, section)} />
{/each}

<style>
    .blocked {
        display: grid;
        gap: 16px;
    }

    /* Named like a script's card (see FingerprintCard). */
    .who {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    .name {
        display: block;
        min-width: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .origin {
        min-width: 0;
        font-size: 14px;
    }

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
