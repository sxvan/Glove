<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from 'wxt/browser';
    import type { AnalysisUpdatedMessage, GetTabSnapshotMessage } from '@/types/messages';
    import type { TabSnapshot } from '@/types/snapshot';
    import CategoryCard from './components/CategoryCard.svelte';
    import DetailHeader from './components/DetailHeader.svelte';
    import MiddleTruncate from './components/MiddleTruncate.svelte';
    import { buildCategories, buildSummary, cnameDetails, dnsDetails, fingerprintingDetails, fingerprintingPageDetail, pageHost, pageUrl, type Category } from './model';
    import CnameDetail from './screens/CnameDetail.svelte';
    import DnsDetail from './screens/DnsDetail.svelte';
    import FingerprintingDetail from './screens/FingerprintingDetail.svelte';

    type Status = 'loading' | 'ready' | 'unavailable';

    // Third parties listed under the summary before the rest is summed up as "+N".
    const MAX_PARTIES = 6;

    let status = $state<Status>('loading');
    let snapshot = $state<TabSnapshot | undefined>();
    // The category whose detail screen is open; null shows the overview.
    let openCategoryId = $state<Category['id'] | null>(null);

    const categories = $derived(snapshot ? buildCategories(snapshot) : []);
    const openCategory = $derived(categories.find((c) => c.id === openCategoryId));

    function openDetail(id: Category['id'] | null) {
        openCategoryId = id;
        window.scrollTo(0, 0);
    }
    const summary = $derived(snapshot ? buildSummary(snapshot) : null);
    const url = $derived(snapshot ? pageUrl(snapshot) : null);
    const host = $derived(snapshot ? pageHost(snapshot) : '');

    function show(next: TabSnapshot | undefined) {
        snapshot = next;
        status = next ? 'ready' : 'unavailable';
    }

    async function getActiveTabId(): Promise<number | undefined> {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        return tab?.id;
    }

    onMount(() => {
        getActiveTabId().then((tabId) => {
            if (tabId === undefined) {
                status = 'unavailable';
                return;
            }

            const message: GetTabSnapshotMessage = { type: 'GET_TAB_SNAPSHOT', tabId };
            browser.runtime.sendMessage(message).then(
                (next: TabSnapshot | undefined) => show(next),
                () => (status = 'unavailable')
            );
        });

        // Live updates from the background while the popup is open
        const onMessage = (message: AnalysisUpdatedMessage) => {
            if (message?.type !== 'ANALYSIS_UPDATED') return;

            getActiveTabId().then((tabId) => {
                if (tabId === message.tabId) show(message.data);
            });
        };

        browser.runtime.onMessage.addListener(onMessage);
        return () => browser.runtime.onMessage.removeListener(onMessage);
    });
</script>

<header>
    <h1 title={url ?? ''}><MiddleTruncate text={host || 'Web Tracking Detector'} /></h1>
    <div class="actions">
        {#if status === 'ready'}<span class="live" title="Updates while the page is open">Live</span>{/if}
        <button class="settings" type="button" title="Scoring settings" aria-label="Scoring settings" onclick={() => browser.runtime.openOptionsPage()}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path
                    d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                />
            </svg>
        </button>
    </div>
</header>

<main>
    {#if status === 'loading'}
        <p class="state">Checking this page…</p>
    {:else if status === 'unavailable'}
        <p class="state">No data for this tab yet. Reload the page to check it.</p>
    {:else if openCategory && snapshot}
        <DetailHeader category={openCategory} onBack={() => openDetail(null)} backOnly={openCategory.id === 'fingerprinting'} />
        {#if openCategory.id === 'fingerprinting'}
            {@const scripts = fingerprintingDetails(snapshot)}
            <FingerprintingDetail page={fingerprintingPageDetail(snapshot, scripts)} {scripts} />
        {:else if openCategory.id === 'cname'}
            <CnameDetail aliases={cnameDetails(snapshot)} />
        {:else}
            <DnsDetail hosts={dnsDetails(snapshot)} />
        {/if}
    {:else}
        {#if summary}
            <div class="summary">
                <p class="headline">{summary.headline}</p>
                {#if summary.parties.length > 0}
                    <p class="parties" title={summary.parties.join(', ')}>
                        {summary.parties.slice(0, MAX_PARTIES).join('  ')}{#if summary.parties.length > MAX_PARTIES}<span class="more">
                                +{summary.parties.length - MAX_PARTIES}</span
                            >{/if}
                    </p>
                {/if}
            </div>
        {/if}
        {#each categories as category, i (category.id)}
            <CategoryCard {category} tipAbove={i > 0} onOpen={() => openDetail(category.id)} />
        {/each}
    {/if}
</main>

<style>
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 16px 8px;
    }

    /* One line, shortened in the middle when too long (see MiddleTruncate). */
    h1 {
        min-width: 0;
        margin: 0;
        font-size: 16px;
    }

    .actions {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 12px;
    }

    .settings {
        display: flex;
        padding: 2px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted);
        cursor: pointer;
    }

    .settings:hover {
        color: var(--text);
    }

    .live {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
        color: var(--muted);
        font-size: 12px;
    }

    .live::before {
        content: '';
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--unlikely);
    }

    main {
        display: grid;
        gap: 16px;
        padding: 16px 16px 24px;
    }

    .summary {
        margin-bottom: 8px;
    }

    .headline {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        line-height: 1.3;
    }

    .parties {
        margin: 6px 0 0;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .more {
        opacity: 0.8;
    }

    .state {
        margin: 0;
        color: var(--muted);
    }
</style>
