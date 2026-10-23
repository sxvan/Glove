<script lang="ts">
    import { browser } from 'wxt/browser';
    import type { SetAllowedMessage } from '@/types/messages';
    import BlockToggle from '../components/BlockToggle.svelte';
    import FingerprintCard from '../components/FingerprintCard.svelte';
    import FoldHeading from '../components/FoldHeading.svelte';
    import MiddleTruncate from '@/ui/components/MiddleTruncate.svelte';
    import { plural } from '@/ui/format';
    import type { BlockedDetail, ScriptDetail } from '@/ui/model';

    // Blocked scripts that tried to load come first, to unblock them; scripts unlikely to fingerprint
    // are folded under a heading of their own, so the suspicious ones are what shows.
    let {
        page,
        scripts,
        blocked,
        onDetails,
    }: {
        page: ScriptDetail;
        scripts: ScriptDetail[];
        blocked: BlockedDetail[];
        onDetails: (key: string, statement: string) => void;
    } = $props();

    let open = $state({ scripts: true, unlikely: false });

    const suspicious = $derived(scripts.filter((script) => script.likelihood === 'possible' || script.likelihood === 'likely'));
    const unlikely = $derived(scripts.filter((script) => !suspicious.includes(script)));
    const listed = $derived(blocked.length + suspicious.length);

    async function allow(url: string) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const message: SetAllowedMessage = { type: 'SET_ALLOWED', url, tabId: tab?.id ?? null };
        await browser.runtime.sendMessage(message);
    }
</script>

<!-- The page's card also without fingerprinting, when it has something to say, such as requests through an alias. -->
{#if scripts.length === 0 && page.aliased.length === 0}
    <p class="empty">No script on this page has read identifying device details so far.</p>
{:else}
    <FingerprintCard script={page} onDetails={(statement) => onDetails(page.key, statement)} />
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
            <BlockToggle url={script.url} label="Block this script" detail={[script.attempts === 1 ? 'Tried to load once' : `Tried to load ${plural(script.attempts, 'time')}`, script.pattern && `Blocked by ${script.pattern}`].filter(Boolean).join(' · ')} />
            {#if script.pattern}
                <div class="allow">
                    <span class="allow-text">Let this address run; the pattern keeps blocking the others.</span>
                    <button type="button" class="button" onclick={() => allow(script.url)}>Allow</button>
                </div>
            {/if}
        </article>
    {/each}

    {#each suspicious as script (script.key)}
        <FingerprintCard {script} onDetails={(statement) => onDetails(script.key, statement)} />
    {/each}
{/if}

{#if unlikely.length > 0}
    <FoldHeading title="Unlikely scripts" count={unlikely.length} bind:open={open.unlikely} />
    {#if open.unlikely}
        {#each unlikely as script (script.key)}
            <FingerprintCard {script} onDetails={(statement) => onDetails(script.key, statement)} />
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

    .allow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }

    .allow-text {
        color: var(--muted);
        font-size: 12px;
    }

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
