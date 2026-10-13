<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from 'wxt/browser';
    import type { AnalysisUpdatedMessage, GetTabSnapshotMessage } from '@/types/messages';
    import type { TabSnapshot } from '@/types/snapshot';
    import CnameCard from './components/CnameCard.svelte';
    import DnsCard from './components/DnsCard.svelte';
    import FingerprintCard from './components/FingerprintCard.svelte';
    import { pickMainDocument } from './format';

    /** False until the background has answered; the cards show placeholders until then. */
    let loaded = $state(false);
    let snapshot = $state<TabSnapshot | undefined>();

    const doc = $derived(pickMainDocument(snapshot));

    function show(next: TabSnapshot | undefined) {
        snapshot = next;
        loaded = true;
    }

    async function getActiveTabId(): Promise<number | undefined> {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        return tab?.id;
    }

    onMount(() => {
        getActiveTabId().then((tabId) => {
            if (tabId === undefined) {
                console.warn('No active tab found for popup');
                return;
            }

            const message: GetTabSnapshotMessage = { type: 'GET_TAB_SNAPSHOT', tabId };
            browser.runtime.sendMessage(message).then(
                (next: TabSnapshot | undefined) => show(next),
                () => {}
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
    <div class="titleRow">
        <div class="title">Tracking Snapshot</div>
        <div class="pill">{loaded && snapshot ? 'Live' : 'No data'}</div>
    </div>
    <div class="sub" title={loaded ? (doc?.url ?? '') : undefined}>{loaded ? (doc?.url ?? '—') : '—'}</div>
</header>

<main>
    <section class="grid" aria-label="Overview">
        <FingerprintCard {loaded} metrics={doc?.fpMetrics ?? null} scripts={doc?.scripts ?? []} />
        <CnameCard {loaded} requests={snapshot?.cNameRequests ?? []} />
        <DnsCard {loaded} requests={snapshot?.dnsTrackingRequests ?? []} />
    </section>
</main>
