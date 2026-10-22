<script lang="ts">
    // The sites the extension is off for (see lib/sites), to turn it on again there; like the lists
    // of the Blocking section.
    import { onMount } from 'svelte';
    import { loadOffSites, removeOffSites, watchOffSites, type OffSite } from '@/lib/sites';
    import { day } from '../popup/format';
    import SectionHead from './SectionHead.svelte';

    let sites = $state<OffSite[]>([]);
    let open = $state(false);
    const sorted = $derived([...sites].sort((a, b) => b.since - a.since));

    onMount(() => {
        loadOffSites().then((loaded) => (sites = loaded));
        return watchOffSites((changed) => (sites = changed));
    });

    function turnOnAll() {
        if (confirm(`Turn the extension on again for ${sites.length === 1 ? 'the site' : `all ${sites.length} sites`}? Their pages are recorded, scored and blocked again from their next load.`)) {
            removeOffSites(sites.map(({ site }) => site));
        }
    }

</script>

<!-- No reset: the list is the user's choices, turned on again with its own buttons. -->
<SectionHead title="Sites" />

<div class="row">
    <div>
        <div class="name">Off for these sites <span class="count">{sites.length}</span></div>
        <div class="description">
            Turned off with the switch in the popup: nothing on them is recorded, scored or blocked, and nothing of the extension is in their pages. Each
            covers its subdomains too.
        </div>
    </div>
    <div class="actions">
        {#if sites.length > 0}
            <button type="button" class="button" aria-expanded={open} onclick={() => (open = !open)}>{open ? 'Hide' : 'Show'}</button>
            <button type="button" class="button" onclick={turnOnAll}>Turn on all</button>
        {/if}
    </div>
</div>
{#if open && sites.length > 0}
    <ul class="sites">
        {#each sorted as { site, since } (site)}
            <li>
                <div>
                    <div class="site">{site}</div>
                    <div class="description">And its subdomains · {day(since)}</div>
                </div>
                <button type="button" class="button" onclick={() => removeOffSites([site])}>Turn on</button>
            </li>
        {/each}
    </ul>
{/if}

<style>
    .sites {
        display: grid;
        gap: 2px;
        margin: 0 0 8px;
        padding: 0;
        list-style: none;
    }

    .sites li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 16px;
        padding: 8px 0;
        border-top: 1px solid var(--border);
    }

    .site {
        overflow: hidden;
        font-family: var(--mono);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
