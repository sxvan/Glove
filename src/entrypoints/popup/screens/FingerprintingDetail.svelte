<script lang="ts">
    import BlockToggle from '../components/BlockToggle.svelte';
    import FingerprintCard from '../components/FingerprintCard.svelte';
    import FoldHeading from '../components/FoldHeading.svelte';
    import MiddleTruncate from '../components/MiddleTruncate.svelte';
    import { plural } from '../format';
    import type { BlockedDetail, ScriptDetail } from '../model';

    // The page as a whole, then under a heading each script that read fingerprinting APIs, in the
    // same kind of card; first among them the blocked scripts that tried to load, to unblock them.
    // Scripts unlikely to fingerprint come after them, under a heading of their own, so the suspicious
    // ones are what shows. Each heading folds its cards (see FoldHeading): the scripts' open at first,
    // the unlikely ones' folded; `open` is kept by the caller, so it stays after a script's page.
    // `onDetails` opens a script's page (by its key) at a section.
    let {
        page,
        scripts,
        blocked,
        onDetails,
        open = $bindable({ scripts: true, unlikely: false }),
    }: {
        page: ScriptDetail;
        scripts: ScriptDetail[];
        blocked: BlockedDetail[];
        onDetails: (key: string, section: string) => void;
        open?: { scripts: boolean; unlikely: boolean };
    } = $props();

    // Below the possible cutoff, as their likelihood says (see fpLikelihood).
    const suspicious = $derived(scripts.filter((script) => script.likelihood === 'possible' || script.likelihood === 'likely'));
    const unlikely = $derived(scripts.filter((script) => !suspicious.includes(script)));
    // Under "Scripts": the blocked ones and the suspicious ones; the unlikely ones are counted under their own heading.
    const listed = $derived(blocked.length + suspicious.length);
</script>

{#if scripts.length === 0}
    <p class="empty">No script on this page has read identifying device details so far.</p>
{:else}
    <FingerprintCard script={page} onDetails={(section) => onDetails(page.key, section)} />
{/if}
{#if listed > 0}
    <FoldHeading title="Scripts" count={listed} bind:open={open.scripts} />
{/if}

{#if open.scripts}
    {#each blocked as script (script.key)}
        <article class="card blocked">
            <div class="who">
                <span class="name" title={script.url}><MiddleTruncate text={script.name} path /></span>
                <span class="origin"><MiddleTruncate text={script.origin} /></span>
            </div>
            <BlockToggle url={script.url} label="Block this script" detail={script.attempts === 1 ? 'Tried to load once' : `Tried to load ${plural(script.attempts, 'time')}`} />
        </article>
    {/each}

    {#each suspicious as script (script.key)}
        <FingerprintCard {script} onDetails={(section) => onDetails(script.key, section)} />
    {/each}
{/if}

{#if unlikely.length > 0}
    <FoldHeading title="Unlikely scripts" count={unlikely.length} bind:open={open.unlikely} />
    {#if open.unlikely}
        {#each unlikely as script (script.key)}
            <FingerprintCard {script} onDetails={(section) => onDetails(script.key, section)} />
        {/each}
    {/if}
{/if}

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

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
