<script lang="ts">
    // A page's fingerprinting in full, for the tab in the address (?tab=): what all its scripts read,
    // sent and stored, as tables to search and sort, a row per script and API, request or stored
    // value. Opened from an info line in the popup, at its table (#apis, #requests, #stored) and
    // script (&script=). Follows the tab's recording while it records; once the tab is closed, it
    // keeps the last one, as the extension keeps nothing of a closed tab.
    import { onMount } from 'svelte';
    import { browser } from 'wxt/browser';
    import { viewerUrl } from '@/lib/script-viewer';
    import type { AnalysisUpdatedMessage, GetTabSnapshotMessage } from '@/types/messages';
    import type { StoredItem, TabSnapshot } from '@/types/snapshot';
    import { bytes, elapsed, plural } from '../popup/format';
    import { fingerprintingDetails, fingerprintingPageDetail, pageHost, pageUrl, type ApiDetail, type ScriptDetail, type SentRequest, type StoredDetail } from '../popup/model';
    import { STORAGE_WORDS } from '../popup/statements';
    import LikelihoodLabel from '../popup/components/LikelihoodLabel.svelte';
    import MiddleTruncate from '../popup/components/MiddleTruncate.svelte';
    import ScoreRing from '../popup/components/ScoreRing.svelte';
    import DataTable from './DataTable.svelte';
    import type { Column, Sorting } from './columns';

    const params = new URLSearchParams(location.search);
    const tabId = Number(params.get('tab'));

    type TableId = 'apis' | 'requests' | 'stored';
    const TABLES: { id: TableId; label: string }[] = [
        { id: 'apis', label: 'APIs read' },
        { id: 'requests', label: 'Requests sent' },
        { id: 'stored', label: 'Values stored' },
    ];
    const tableOf = (hash: string): TableId => TABLES.find((t) => `#${t.id}` === hash)?.id ?? 'apis';

    let snapshot = $state<TabSnapshot | undefined>();
    let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
    // The tab was closed: what shows is its last recording.
    let closed = $state(false);
    let table = $state<TableId>(tableOf(location.hash));
    // The script the tables are narrowed to, by its key; empty for all of them.
    let scriptKey = $state(params.get('script') ?? '');
    let query = $state('');

    const scripts = $derived(snapshot ? fingerprintingDetails(snapshot) : []);
    const page = $derived(snapshot ? fingerprintingPageDetail(snapshot, scripts) : null);
    const host = $derived(snapshot ? pageHost(snapshot) : '');
    const shownScripts = $derived(scriptKey ? scripts.filter((s) => s.key === scriptKey) : scripts);

    function choose(id: TableId) {
        table = id;
        history.replaceState(null, '', `${location.search}#${id}`);
    }

    // ---------- the rows, each with the text the search looks in ----------

    type ApiRow = { script: ScriptDetail; api: ApiDetail; text: string };
    type RequestRow = { script: ScriptDetail; request: SentRequest; text: string };
    type StoredRow = { script: ScriptDetail; item: StoredDetail; text: string };

    const words = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ').toLowerCase();
    const scriptWords = (script: ScriptDetail) => words(script.name, script.origin, script.url);

    const apiRows = $derived(shownScripts.flatMap((script) => script.apiDetails.map((api): ApiRow => ({ script, api, text: words(scriptWords(script), api.id, api.kind, api.reveals) }))));
    const requestRows = $derived(
        shownScripts.flatMap((script) =>
            script.requests.map((request): RequestRow => ({ script, request, text: words(scriptWords(script), request.site, request.via, request.url, request.method, request.how, ...request.params) }))
        )
    );
    const storedRows = $derived(
        shownScripts.flatMap((script) =>
            script.stored.map((item): StoredRow => ({ script, item, text: words(scriptWords(script), item.name, STORAGE_WORDS[item.kind], item.value, item.identifier && `${item.identifier} identifier`) }))
        )
    );

    /** Rows holding every word searched for, in any column. */
    function matching<Row extends { text: string }>(rows: Row[]): Row[] {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        return terms.length === 0 ? rows : rows.filter((row) => terms.every((term) => row.text.includes(term)));
    }

    // ---------- the columns ----------

    const scriptColumn = <Row extends { script: ScriptDetail }>(): Column<Row> => ({ key: 'script', label: 'Script', sortBy: (row) => row.script.name });

    const API_COLUMNS: Column<ApiRow>[] = [
        scriptColumn(),
        { key: 'api', label: 'API', sortBy: (row) => row.api.id },
        { key: 'reveals', label: 'Reveals', sortBy: (row) => row.api.reveals },
        { key: 'rareBits', label: 'Rare bits', numeric: true, title: 'What it counts toward the score: its bits, as counted beside the other APIs read, times its rarity weight', sortBy: (row) => row.api.counted.rareBits },
        { key: 'bits', label: 'Bits', numeric: true, title: 'Identifying information on its own: 6 bits tell one browser in 64 apart', sortBy: (row) => row.api.bits },
        { key: 'rarity', label: 'Rarity', numeric: true, title: 'How rarely pages use it: 1 − the share of page loads using it, from Chrome’s usage statistics', sortBy: (row) => row.api.rarity },
        { key: 'calls', label: 'Calls', numeric: true, sortBy: (row) => row.api.calls },
        { key: 'first', label: 'First read', numeric: true, title: 'When it was first read, after the page started', sortBy: (row) => row.api.first },
    ];

    const REQUEST_COLUMNS: Column<RequestRow>[] = [
        scriptColumn(),
        { key: 'site', label: 'Sent to', sortBy: (row) => row.request.site },
        { key: 'path', label: 'Address', sortBy: (row) => row.request.path },
        { key: 'method', label: 'Method', nowrap: true, sortBy: (row) => row.request.method },
        { key: 'how', label: 'How', nowrap: true, sortBy: (row) => row.request.how },
        { key: 'bytes', label: 'Data', numeric: true, title: 'How much data it carried: its body and its address’s query', sortBy: (row) => row.request.bytes },
        { key: 'after', label: 'After reading', numeric: true, title: 'How long after a burst of calls it was sent; – for a request at another time', sortBy: (row) => row.request.afterMs },
    ];

    const IDENTIFIER_ORDER = { likely: 2, possible: 1 };
    const STORED_COLUMNS: Column<StoredRow>[] = [
        scriptColumn(),
        { key: 'name', label: 'Name', sortBy: (row) => row.item.name },
        { key: 'identifier', label: 'Identifier', nowrap: true, largestFirst: true, title: 'Whether it looks like an identifier (see the settings’ Stored identifiers)', sortBy: (row) => (row.item.identifier ? IDENTIFIER_ORDER[row.item.identifier] : 0) },
        { key: 'where', label: 'Where', nowrap: true, sortBy: (row) => STORAGE_WORDS[row.item.kind] },
        { key: 'kept', label: 'Kept', numeric: true, sortBy: (row) => keptMs(row.item) },
        { key: 'writes', label: 'Writes', numeric: true, sortBy: (row) => row.item.writes },
        { key: 'value', label: 'Value', width: '30%', sortBy: (row) => row.item.value },
    ];

    // Each table's order, kept while switching between them.
    let sorting = $state<Record<TableId, Sorting>>({
        apis: { key: 'rareBits', descending: true },
        requests: { key: 'bytes', descending: true },
        stored: { key: 'identifier', descending: true },
    });

    // ---------- how values read ----------

    const HOW: Record<NonNullable<SentRequest['how']>, string> = { fetch: 'fetch', xhr: 'XMLHttpRequest', beacon: 'sendBeacon', image: 'Image (pixel)' };
    // Points with one decimal, or two below 1, as in the score's breakdown.
    const amount = (x: number) => String(+x.toFixed(x < 1 ? 2 : 1));
    const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

    const DAY = 24 * 60 * 60 * 1000;
    /** How long it stays after it was written; storage kept until cleared sorts as the longest. */
    function keptMs(item: StoredItem): number {
        if (item.kind !== 'cookie') return item.kind === 'sessionStorage' ? 0 : Infinity;
        return item.expires === null ? 0 : item.expires - item.last;
    }
    /** As the popup says it: "1 year", "30 days", "until cleared", "until the browser closes". */
    function kept(item: StoredItem): string {
        if (item.kind !== 'cookie') return item.kind === 'sessionStorage' ? 'until the tab closes' : 'until cleared';
        if (item.expires === null) return 'until the browser closes';
        const ms = item.expires - item.last;
        if (ms >= 360 * DAY) return plural(Math.round(ms / (365 * DAY)), 'year');
        if (ms >= DAY) return plural(Math.round(ms / DAY), 'day');
        if (ms >= 60 * 60 * 1000) return plural(Math.round(ms / (60 * 60 * 1000)), 'hour');
        return plural(Math.max(1, Math.round(ms / 60000)), 'minute');
    }

    // ---------- the tab's recording ----------

    onMount(() => {
        if (!Number.isInteger(tabId)) {
            status = 'unavailable';
            return;
        }
        // As a popup does, so the background sends the tab's updates (see broadcastTabSnapshot).
        const port = browser.runtime.connect({ name: 'popup' });
        const message: GetTabSnapshotMessage = { type: 'GET_TAB_SNAPSHOT', tabId };
        browser.runtime.sendMessage(message).then(
            (next: TabSnapshot | undefined) => {
                snapshot = next;
                status = next ? 'ready' : 'unavailable';
            },
            () => (status = 'unavailable')
        );
        const onMessage = (update: AnalysisUpdatedMessage) => {
            if (update?.type === 'ANALYSIS_UPDATED' && update.tabId === tabId && !closed) {
                snapshot = update.data;
                status = 'ready';
            }
        };
        const onRemoved = (removedId: number) => {
            if (removedId === tabId) closed = true;
        };
        const onHash = () => (table = tableOf(location.hash));
        browser.runtime.onMessage.addListener(onMessage);
        browser.tabs.onRemoved.addListener(onRemoved);
        window.addEventListener('hashchange', onHash);
        return () => {
            browser.runtime.onMessage.removeListener(onMessage);
            browser.tabs.onRemoved.removeListener(onRemoved);
            window.removeEventListener('hashchange', onHash);
            port.disconnect();
        };
    });

    $effect(() => {
        document.title = host ? `${host} – Glove` : 'Glove';
    });
</script>

{#snippet scriptCell(script: ScriptDetail)}
    <!-- Named like its card: its path, the file name kept, over who serves it; linked to the viewer. -->
    <div class="script">
        {#if script.viewer}
            <a class="name" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer"><MiddleTruncate text={script.name} path={script.path} /></a>
        {:else}
            <span class="name" title={script.url}><MiddleTruncate text={script.name} path={script.path} /></span>
        {/if}
        <span class="origin" title={script.originTitle}>{#if script.path}<MiddleTruncate text={script.origin} />{:else}{script.origin}{/if}</span>
    </div>
{/snippet}

{#snippet apiCell(row: ApiRow, key: string)}
    {#if key === 'script'}{@render scriptCell(row.script)}
    {:else if key === 'api'}<span class="code">{row.api.id}</span>
    {:else if key === 'reveals'}{capitalize(row.api.reveals || row.api.kind)}
    {:else if key === 'rareBits'}<strong>{amount(row.api.counted.rareBits)}</strong>
    {:else if key === 'bits'}{amount(row.api.bits)}
    {:else if key === 'rarity'}<span title="Used on {+((1 - row.api.rarity) * 100).toFixed(1)}% of page loads">{row.api.rarity}</span>
    {:else if key === 'calls'}{row.api.calls.toLocaleString('en-US')}
    {:else if key === 'first'}{row.api.first === null ? '–' : elapsed(row.api.first)}
    {/if}
{/snippet}

{#snippet requestCell(row: RequestRow, key: string)}
    {#if key === 'script'}{@render scriptCell(row.script)}
    {:else if key === 'site'}{row.request.site}{#if row.request.via}<span class="origin" title="An address of the site that is an alias (CNAME) for it">through {row.request.via}</span>{/if}
    {:else if key === 'path'}<span class="code path" title={row.request.url}><MiddleTruncate text={row.request.path} path /></span>{#if row.request.params.length > 0}<span class="origin">{row.request.params.join(', ')}</span>{/if}
    {:else if key === 'method'}<span class="code">{row.request.method}</span>
    {:else if key === 'how'}{row.request.how ? HOW[row.request.how] : '–'}
    {:else if key === 'bytes'}{bytes(row.request.bytes)}
    {:else if key === 'after'}{row.request.afterMs === null ? '–' : row.request.afterMs === 0 ? 'while reading' : `${Math.round(row.request.afterMs)} ms`}
    {/if}
{/snippet}

{#snippet storedCell(row: StoredRow, key: string)}
    {#if key === 'script'}{@render scriptCell(row.script)}
    {:else if key === 'name'}<span class="code">{row.item.name || '(no name)'}</span>
    {:else if key === 'identifier'}{#if row.item.identifier}<span class="tag tone-{row.item.identifier}">{capitalize(row.item.identifier)}</span>{:else}–{/if}
    {:else if key === 'where'}{capitalize(STORAGE_WORDS[row.item.kind])}
    {:else if key === 'kept'}{kept(row.item)}
    {:else if key === 'writes'}{row.item.writes}
    {:else if key === 'value'}{#if row.item.value !== null}<span class="code">{row.item.value || '(empty)'}</span>{:else}–{/if}
    {/if}
{/snippet}

<main>
    <header>
        <div class="title">
            <span class="brand">Glove</span>
            <h1 title={snapshot ? (pageUrl(snapshot) ?? '') : ''}>{host || 'Fingerprinting'}</h1>
            {#if closed}<p class="note">The tab was closed: this is its last recording.</p>{/if}
        </div>
        {#if page}
            <div class="rating">
                <ScoreRing value={page.score} color="var(--{page.likelihood})" scale={100} empty={page.likelihood === 'unknown'} title="The page's score: {Math.round(page.score * 100)}" />
                <LikelihoodLabel likelihood={page.likelihood} />
            </div>
        {/if}
    </header>

    {#if status === 'loading'}
        <p class="state">Loading the tab's recording…</p>
    {:else if status === 'unavailable' || !snapshot}
        <p class="state">No recording for this tab: it was closed, or the page hasn't loaded since the extension started. Reload the page and open this again from the popup.</p>
    {:else}
        <div class="controls">
            <div class="tables" role="tablist">
                {#each TABLES as { id, label } (id)}
                    {@const count = id === 'apis' ? apiRows.length : id === 'requests' ? requestRows.length : storedRows.length}
                    <button type="button" role="tab" aria-selected={table === id} onclick={() => choose(id)}>{label} <span class="count">{count}</span></button>
                {/each}
            </div>
            <div class="filters">
                <input type="search" placeholder="Search, e.g. webgl or a script's name" bind:value={query} aria-label="Search the table" />
                <select bind:value={scriptKey} aria-label="Script">
                    <option value="">All scripts ({scripts.length})</option>
                    {#each scripts as script (script.key)}
                        <option value={script.key}>{script.name.split('/').pop() || script.name} · {Math.round(script.score * 100)}</option>
                    {/each}
                </select>
            </div>
        </div>

        <section class="squircle">
            {#if table === 'apis'}
                <DataTable rows={matching(apiRows)} columns={API_COLUMNS} cell={apiCell} bind:sorting={sorting.apis} empty="No fingerprinting APIs read that match." />
            {:else if table === 'requests'}
                <DataTable rows={matching(requestRows)} columns={REQUEST_COLUMNS} cell={requestCell} bind:sorting={sorting.requests} empty="No requests with data that match." />
            {:else}
                <DataTable rows={matching(storedRows)} columns={STORED_COLUMNS} cell={storedCell} bind:sorting={sorting.stored} empty="No stored values that match." />
            {/if}
        </section>
    {/if}
</main>

<style>
    main {
        display: grid;
        gap: 20px;
        max-width: 1400px;
        margin: 0 auto;
        padding: 24px 24px 48px;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
    }

    .brand {
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
    }

    h1 {
        margin: 2px 0 0;
        font-size: 20px;
    }

    .note {
        margin: 4px 0 0;
        color: var(--possible);
        font-size: 12px;
    }

    .rating {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .state {
        margin: 0;
        color: var(--muted);
    }

    /* The tables to choose from, then the search and the script it is narrowed to. */
    .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .tables {
        display: flex;
        gap: 2px;
        padding: 2px;
        border-radius: 9px;
        background: var(--fill);
    }

    .tables button {
        padding: 6px 12px;
        border: 0;
        border-radius: 7px;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
    }

    .tables button:hover {
        color: var(--text);
    }

    .tables button[aria-selected='true'] {
        background: var(--surface);
        box-shadow: 0 1px 3px var(--shadow);
        color: var(--text);
        font-weight: 500;
    }

    .count {
        margin-left: 2px;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
    }

    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    input,
    select {
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 13px;
    }

    /* Room for a few words of search. */
    input {
        width: 24em;
        max-width: 100%;
    }

    /* As wide as a script's file name, not the longest one's. */
    select {
        max-width: 20em;
    }

    input:focus,
    select:focus {
        border-color: var(--muted);
        outline: none;
    }

    /* The table on a card, inset a little, so its rows' backgrounds stay inside the rounded corners. */
    section {
        padding: 6px;
        border-radius: 14px;
        background: var(--surface);
    }

    /* A script's name over who serves it, the same width in every table: room for a path's last
       parts and a host, both shortened in the middle beyond (see MiddleTruncate). */
    .script {
        display: grid;
        width: 18em;
    }

    .name {
        min-width: 0;
        color: var(--text);
        font-weight: 500;
        text-decoration: none;
    }

    a.name:hover {
        text-decoration: underline;
    }

    .origin {
        display: block;
        color: var(--muted);
        font-size: 12px;
    }

    /* Names and values of code: broken anywhere when too long for their column, as they are often
       one long word (an API id, a cookie name). */
    .code {
        font-family: var(--mono);
        font-size: 12px;
        overflow-wrap: anywhere;
    }

    .path {
        display: block;
        max-width: 28em;
    }

    .tag {
        padding: 0 6px;
        border: 1px solid var(--color);
        border-radius: 4px;
        color: var(--color);
        font-size: 11px;
        font-weight: 600;
    }
</style>
