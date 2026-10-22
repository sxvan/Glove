<script lang="ts">
    import { browser } from 'wxt/browser';
    import type { AnalysisUpdatedMessage, GetTabSnapshotMessage, SetSiteOffMessage } from '@/types/messages';
    import type { TabSnapshot } from '@/types/snapshot';
    import MiddleTruncate from '@/ui/components/MiddleTruncate.svelte';
    import Switch from '@/ui/components/Switch.svelte';
    import { loadOffSites, offEntryFor, switchableHost, watchOffSites, type OffSite } from '@/lib/sites';
    import { blockedDetails, fingerprintingDetails, fingerprintingPageDetail, pageHost, pageUrl } from '@/ui/model';
    import { tableOf } from './statements';
    import FingerprintingDetail from './screens/FingerprintingDetail.svelte';
    import { onMount } from 'svelte';

    type Status = 'loading' | 'ready' | 'unavailable';

    let status = $state<Status>('loading');
    let snapshot = $state<TabSnapshot | undefined>();

    const scripts = $derived(snapshot ? fingerprintingDetails(snapshot) : []);
    const page = $derived(snapshot ? fingerprintingPageDetail(snapshot, scripts) : null);

    // Narrowed to the script; from the page's card, all scripts.
    function openDetails(key: string, statement: string) {
        if (tabId === undefined) return;
        const script = key === page?.key ? '' : `&script=${encodeURIComponent(key)}`;
        browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}?tab=${tabId}${script}#${tableOf(statement)}` });
    }

    let tabId = $state<number | undefined>();
    let tabUrl = $state<string | undefined>();
    let offSites = $state<OffSite[]>([]);
    const tabHost = $derived(switchableHost(tabUrl));
    const offEntry = $derived(offEntryFor(tabHost, offSites));

    const url = $derived(snapshot ? pageUrl(snapshot) : (tabUrl ?? null));
    const host = $derived((snapshot ? pageHost(snapshot) : '') || tabHost || '');

    function setOn(on: boolean) {
        if (!tabHost || tabId === undefined) return;
        const message: SetSiteOffMessage = { type: 'SET_SITE_OFF', host: tabHost, off: !on, tabId };
        browser.runtime.sendMessage(message);
    }

    function show(next: TabSnapshot | undefined) {
        snapshot = next;
        status = next ? 'ready' : 'unavailable';
    }

    async function getActiveTabId(): Promise<number | undefined> {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabUrl = tab?.url;
        tabId = tab?.id;
        return tab?.id;
    }

    onMount(() => {
        // So the background sends updates while the popup is open (see publishAnalysis).
        const port = browser.runtime.connect({ name: 'view' });
        loadOffSites().then((sites) => (offSites = sites));
        const stopOffSites = watchOffSites((sites) => (offSites = sites));
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

        const onMessage = (message: AnalysisUpdatedMessage) => {
            if (message?.type !== 'ANALYSIS_UPDATED') return;

            getActiveTabId().then((tabId) => {
                if (tabId === message.tabId) show(message.data);
            });
        };

        browser.runtime.onMessage.addListener(onMessage);
        return () => {
            browser.runtime.onMessage.removeListener(onMessage);
            stopOffSites();
            port.disconnect();
        };
    });
</script>

<header>
    <div class="title">
        <span class="brand">Glove</span>
        <h1 title={url ?? ''}><MiddleTruncate text={host || 'This tab'} /></h1>
    </div>
    <div class="actions">
        {#if tabHost}
            <Switch status checked={!offEntry} onchange={setOn} label={offEntry ? `Off for ${offEntry.site}: turn it on` : `On for this site: turn it off`} />
        {/if}
        <button class="settings" type="button" title="Settings" aria-label="Settings" onclick={() => browser.runtime.openOptionsPage()}>
            <!-- A gear: Lucide's "settings" icon (lucide.dev, ISC license; see THIRD_PARTY_NOTICES.md). -->
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                />
                <circle cx="12" cy="12" r="3" />
            </svg>
        </button>
    </div>
</header>

<main>
    {#if offEntry}
        <p class="state">
            Off for <strong>{offEntry.site}</strong> and its subdomains: nothing on this site is recorded, scored or blocked. Turn it on with the switch above.
        </p>
    {:else if status === 'loading'}
        <p class="state">Checking this page…</p>
    {:else if status === 'unavailable'}
        <p class="state">No data for this tab yet. Reload the page to check it.</p>
    {:else if snapshot && page}
        <FingerprintingDetail {page} {scripts} blocked={blockedDetails(snapshot)} onDetails={openDetails} />
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

    .title {
        display: grid;
        flex: 1;
        min-width: 0;
    }

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

    main {
        display: grid;
        gap: 16px;
        padding: 16px 16px 24px;
    }

    .state {
        margin: 0;
        color: var(--muted);
    }
</style>
