<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from 'wxt/browser';
    import type { AnalysisUpdatedMessage, GetTabSnapshotMessage } from '@/types/messages';
    import type { TabSnapshot } from '@/types/snapshot';
    import CategoryCard from './components/CategoryCard.svelte';
    import DetailHeader from './components/DetailHeader.svelte';
    import { buildCategories, buildSummary, cnameDetails, dnsDetails, fingerprintingDetails, pageHost, pageUrl, type Category } from './model';
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
    <h1 title={url ?? ''}>{host || 'Web Tracking Detector'}</h1>
    {#if status === 'ready'}<span class="live" title="Updates while the page is open">Live</span>{/if}
</header>

<main>
    {#if status === 'loading'}
        <p class="state">Checking this page…</p>
    {:else if status === 'unavailable'}
        <p class="state">No data for this tab yet. Reload the page to check it.</p>
    {:else if openCategory && snapshot}
        <DetailHeader category={openCategory} onBack={() => openDetail(null)} />
        {#if openCategory.id === 'fingerprinting'}
            <FingerprintingDetail scripts={fingerprintingDetails(snapshot)} />
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
        gap: 10px;
        padding: 14px 16px 12px;
        border-bottom: 1px solid var(--border);
    }

    h1 {
        margin: 0;
        font-size: 15px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        gap: 10px;
        padding: 14px 16px 16px;
    }

    .summary {
        margin-bottom: 2px;
    }

    .headline {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.3;
    }

    .parties {
        margin: 4px 0 0;
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
