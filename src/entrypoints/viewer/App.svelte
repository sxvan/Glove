<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { js_beautify } from 'js-beautify/js/lib/beautify.js';
    import { parseViewerQuery, type ViewerApi } from '@/lib/script-viewer';
    import MiddleTruncate from '@/ui/components/MiddleTruncate.svelte';
    import SignalLine from '@/ui/components/SignalLine.svelte';
    import { FP_APIS_BY_ID } from '@/lib/fp-apis';
    import { loadPrivacy, savePrivacy } from '@/lib/privacy';
    import { capitalize, plural } from '@/ui/format';
    import { highlightWithLocations } from './highlight';
    import { inlineScripts } from './inline-scripts';
    import { locateApis, type CodeLocation } from './locations';

    // Larger sources are formatted but not highlighted, which would take too long.
    const MAX_HIGHLIGHT_CHARS = 3_000_000;

    type Status = 'starting' | 'asking' | 'loading' | 'formatting' | 'ready' | 'error';

    interface CodeBlock {
        /** Empty for a script file. */
        title: string;
        detail: string;
        code: string;
        /** Empty when too large to highlight. */
        html: string;
        locations: CodeLocation[];
    }

    const params = parseViewerQuery(location.search);

    let status = $state<Status>('starting');
    let dontAskAgain = $state(false);
    let error = $state('');
    let blocks = $state<CodeBlock[]>([]);
    // False when recorded positions couldn't be matched to the downloaded code.
    let exactAvailable = $state(true);
    let current = $state(-1);

    const locations = $derived(blocks.flatMap((block) => block.locations));

    const found = $derived(
        new Map(
            (params?.apis ?? []).map((api) => {
                const own = locations.filter((l) => l.apis.includes(api.id));
                return [api.id, { count: own.length, exact: own.some((l) => l.exact) }];
            })
        )
    );
    const hasExact = $derived(locations.some((l) => l.exact));
    const hasSearch = $derived(locations.some((l) => !l.exact));
    const generated = $derived(locations.some((l) => l.generated));
    const unconfirmed = $derived(locations.filter((l) => l.exact && !l.confirmed).length);
    const hadPositions = $derived((params?.apis ?? []).some((api) => api.positions.length > 0));
    // The APIs' list stays in view below the sticky header.
    let headerHeight = $state(0);
    const currentApis = $derived(locations[current]?.apis ?? []);

    const server = params ? new URL(params.url).host : '';

    onMount(async () => {
        if (!params) {
            fail('This page needs the address of a script or page (http or https) to show.');
            return;
        }
        const privacy = await loadPrivacy().catch(() => null);
        if (privacy?.askBeforeDownload === false) load();
        else status = 'asking';
    });

    async function download() {
        if (dontAskAgain) {
            const privacy = await loadPrivacy().catch(() => null);
            if (privacy) savePrivacy({ ...privacy, askBeforeDownload: false }).catch(() => {});
        }
        load();
    }

    // Downloaded again: Chrome gives extensions no copy of the code a page ran, only debuggers.
    async function load() {
        if (!params) return;
        status = 'loading';
        let source: string;
        try {
            // Without cookies or referrer, so viewing a script doesn't add to the tracking it shows.
            const response = await fetch(params.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}`);
            source = await response.text();
        } catch (e) {
            fail(`The ${params.inline ? 'page' : 'script'} could not be downloaded: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }

        status = 'formatting';
        await new Promise((resolve) => setTimeout(resolve)); // let the status render before the heavy work

        if (!params.inline) {
            blocks = [markCode(source, params.apis, '', '', 0)];
        } else {
            const { scripts, matched } = inlineScripts(source, params.apis);
            if (scripts.length === 0) {
                fail('The page has no inline scripts anymore; it probably differs from the version that ran.');
                return;
            }
            let next = 0;
            blocks = scripts.map((script, i) => {
                const block = markCode(script.source, script.apis, `Inline script ${i + 1}`, `Line ${script.line} of the page`, next);
                next += block.locations.length;
                return block;
            });
            if (!matched) exactAvailable = false;
        }
        status = 'ready';
    }

    function markCode(source: string, apis: ViewerApi[], title: string, detail: string, firstId: number): CodeBlock {
        const code = js_beautify(source, { indent_size: 2, max_preserve_newlines: 2 });
        if (code.length > MAX_HIGHLIGHT_CHARS) return { title, detail, code, html: '', locations: [] };

        const { locations, exactAvailable: exact } = locateApis(source, code, apis);
        if (!exact) exactAvailable = false;
        return { title, detail, code, html: highlightWithLocations(code, locations, firstId), locations };
    }

    function lineNumbers(code: string): string {
        return Array.from({ length: code.split('\n').length }, (_, i) => i + 1).join('\n');
    }

    function fail(message: string) {
        error = message;
        status = 'error';
    }

    async function goTo(index: number) {
        if (locations.length === 0) return;
        current = (index + locations.length) % locations.length;
        await tick();
        document.querySelector('mark.current')?.classList.remove('current');
        const mark = document.getElementById(`hit-${current}`);
        mark?.classList.add('current');
        mark?.scrollIntoView({ block: 'center' });
    }

    function goToApi(api: string) {
        const after = locations.findIndex((l, i) => i > current && l.apis.includes(api));
        const index = after !== -1 ? after : locations.findIndex((l) => l.apis.includes(api));
        if (index !== -1) goTo(index);
    }
</script>

<header bind:clientHeight={headerHeight}>
    <div class="title">
        <span class="brand">Glove</span>
        <h1 title={params?.name}><MiddleTruncate text={params?.name ?? 'Script viewer'} path={!!params && !params.inline} /></h1>
        {#if params}
            <a class="original" href={params.url} title="Open {params.url}" target="_blank" rel="noopener noreferrer"
                ><MiddleTruncate text={params.url} path plain /><span class="arrow">&nbsp;↗</span></a
            >
        {/if}
    </div>

    {#if status === 'ready' && locations.length > 0}
        <nav class="steps" aria-label="Places of fingerprinting APIs">
            <button type="button" onclick={() => goTo(current - 1)}>Previous</button>
            <span class="position">{current === -1 ? '–' : current + 1} of {locations.length}</span>
            <button type="button" onclick={() => goTo(current + 1)}>Next</button>
        </nav>
    {/if}
</header>

{#if status === 'asking' && params}
    <section class="ask squircle">
        <h2>Download the {params.inline ? 'page' : 'script'} again?</h2>
        <p>
            Glove doesn't keep the code a page runs: Chrome only gives that to debuggers. To show it, Glove downloads the {params.inline
                ? 'page'
                : 'script'} again from <strong>{server}</strong>, without your cookies or the page's address, but the server sees the request
            coming from your IP address, as when the page loaded it.
        </p>
        <div class="ask-actions">
            <button type="button" class="primary" onclick={download}>Download and show</button>
            <label><input type="checkbox" bind:checked={dontAskAgain} /> Don't ask again</label>
        </div>
    </section>
{:else if status === 'loading'}
    <p class="state">Downloading the {params?.inline ? 'page' : 'script'}…</p>
{:else if status === 'formatting'}
    <p class="state">Formatting the {params?.inline ? 'scripts' : 'script'}…</p>
{:else if status === 'error'}
    <p class="state error">{error}</p>
{:else}
    <main class:with-apis={params && params.apis.length > 0} style:--header-height="{headerHeight}px">
        {#if params && params.apis.length > 0}
            <aside class="apis squircle" aria-label="Fingerprinting APIs read by this script">
                <h2>Fingerprinting APIs <span class="count">{params.apis.length}</span></h2>
                <ul>
                    {#each params.apis as api (api.id)}
                        {@const { count, exact } = found.get(api.id) ?? { count: 0, exact: false }}
                        <li>
                            <button
                                type="button"
                                class="api"
                                class:current={currentApis.includes(api.id)}
                                class:search={count > 0 && !exact}
                                disabled={count === 0}
                                title={count === 0 ? 'Not found in this copy of the code' : 'Go to its next place in the code'}
                                onclick={() => goToApi(api.id)}
                            >
                                <span class="api-name">{api.id}</span>
                                <span class="api-meta">
                                    {capitalize(FP_APIS_BY_ID[api.id]?.reveals ?? '')}
                                    <span class="places">
                                        {#if api.calls !== null}{plural(api.calls, 'call')}{' · '}{/if}{count === 0 ? 'not found' : exact ? plural(count, 'place') : `${count}× by name`}
                                    </span>
                                </span>
                            </button>
                        </li>
                    {/each}
                </ul>

                {#if hasExact || hasSearch}
                    <div class="notes">
                        {#if hasExact}
                            <p>Marked places are where the page called each API, recorded from its call stack.</p>
                        {/if}
                        {#if hasSearch}
                            <p>APIs without recorded positions are found by their names (dashed), which misses calls hidden by obfuscation.</p>
                        {/if}
                    </div>
                {/if}
            </aside>
        {/if}

        <div class="blocks">
            <ul class="copy squircle">
                <SignalLine
                    tone="info"
                    lead
                    text={[{ value: 'A copy, downloaded again' }, params?.inline
                        ? ': the page can differ from the one that ran, as a page can change per visit or login.'
                        : ': it can differ from the code the page ran, as servers can send another version per visit or browser.']}
                    detail={generated ? 'Some calls come from code the script generated while running (eval, new Function), which isn’t in this file: they are marked where it was generated.' : ''}
                />
                {#if hadPositions && !exactAvailable}
                    <SignalLine text="The recorded positions couldn't be matched to this copy, so the APIs are searched by their names instead." />
                {/if}
                {#if unconfirmed > 0}
                    <SignalLine
                        text="{plural(unconfirmed, 'recorded position')} {unconfirmed === 1 ? "doesn't" : "don't"} land on the expected API: the server probably sent another version than the one that ran."
                    />
                {/if}
            </ul>
            {#each blocks as block, i (i)}
                <section class="code squircle">
                    {#if block.title}
                        <h2 class="block-title">{block.title} <span class="block-detail">{block.detail}</span></h2>
                    {/if}
                    {#if !block.html}
                        <p class="large">This script is too large to highlight: it is shown formatted only.</p>
                    {/if}
                    <div class="lines">
                        <pre class="gutter" aria-hidden="true">{lineNumbers(block.code)}</pre>
                        {#if block.html}
                            <pre class="source"><code>{@html block.html}</code></pre>
                        {:else}
                            <pre class="source"><code>{block.code}</code></pre>
                        {/if}
                    </div>
                </section>
            {/each}
        </div>
    </main>
{/if}

<style>
    header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 16px 24px;
        background: var(--bg);
    }

    .title {
        display: grid;
        min-width: 0;
    }

    h1 {
        min-width: 0;
        margin: 2px 0 0;
        font-size: 20px;
    }

    .original {
        display: flex;
        min-width: 0;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
        text-decoration: none;
        white-space: nowrap;
    }

    .arrow {
        flex-shrink: 0;
    }

    .original:hover {
        color: var(--text);
        text-decoration: underline;
    }

    .steps {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border-radius: 9px;
        background: var(--fill);
    }

    .steps button {
        padding: 6px 12px;
        border: 0;
        border-radius: 7px;
        background: var(--surface);
        box-shadow: 0 1px 3px var(--shadow);
        color: var(--text);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
    }

    .steps button:hover {
        color: var(--info);
    }

    .position {
        padding: 0 10px;
        color: var(--muted);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .state {
        margin: 8px 24px;
        color: var(--muted);
    }

    /* As wide as a paragraph reads well. */
    .ask {
        display: grid;
        gap: 12px;
        max-width: 40em;
        margin: 8px 24px;
        padding: 20px 24px;
        border-radius: 14px;
        background: var(--surface);
    }

    .ask h2 {
        margin: 0;
        font-size: 16px;
    }

    .ask p {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
    }

    .ask strong {
        color: var(--text);
    }

    .ask-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
    }

    .primary {
        padding: 7px 14px;
        border: 0;
        border-radius: 8px;
        background: var(--info);
        color: #fff;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
    }

    .primary:hover {
        background: color-mix(in srgb, var(--info) 85%, var(--text));
    }

    .ask label {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--muted);
        font-size: 13px;
    }

    .copy {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 14px 16px;
        border-radius: 14px;
        background: var(--surface);
        list-style: none;
    }

    .error {
        color: var(--likely);
    }

    /* The APIs as narrow as a list of them reads well; the code takes the rest. */
    main {
        display: grid;
        gap: 20px;
        align-items: start;
        --gutter: 24px;
        padding: 0 var(--gutter) 48px;
    }

    main.with-apis {
        grid-template-columns: minmax(16em, 22em) minmax(0, 1fr);
    }

    /* Scrolls on its own when longer than the room below the header; the side padding below it. */
    .apis {
        position: sticky;
        top: var(--header-height);
        display: grid;
        gap: 12px;
        max-height: calc(100vh - var(--header-height) - var(--gutter));
        overflow-y: auto;
        padding: 14px 10px 16px;
        border-radius: 14px;
        background: var(--surface);
    }

    h2 {
        margin: 0 8px;
        font-size: 14px;
    }

    .count {
        margin-left: 2px;
        color: var(--muted);
        font-weight: 400;
    }

    .apis ul {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .api {
        display: grid;
        gap: 2px;
        width: 100%;
        padding: 7px 8px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .api:not(:disabled):hover,
    .api.current {
        background: var(--fill);
    }

    .api.current .api-name {
        color: var(--possible);
    }

    .api:disabled {
        cursor: default;
        opacity: 0.5;
    }

    .api-name {
        font-family: var(--mono);
        font-size: 12px;
        overflow-wrap: anywhere;
    }

    .api-meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0 8px;
        color: var(--muted);
        font-size: 12px;
    }

    .places {
        font-variant-numeric: tabular-nums;
    }

    /* As their dashed marks in the code. */
    .api.search .places {
        text-decoration: underline dashed;
        text-underline-offset: 3px;
    }

    .notes {
        display: grid;
        gap: 6px;
        margin: 0 8px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
        color: var(--muted);
        font-size: 12px;
    }

    .notes p {
        margin: 0;
    }

    .blocks {
        display: grid;
        gap: 20px;
        min-width: 0;
    }

    .code {
        overflow: hidden;
        border-radius: 14px;
        background: var(--surface);
    }

    .block-title {
        margin: 0;
        padding: 14px 16px 0;
    }

    .block-detail {
        margin-left: 6px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 400;
    }

    .large {
        margin: 0;
        padding: 14px 16px 0;
        color: var(--muted);
        font-size: 12px;
    }

    .lines {
        display: flex;
    }

    pre {
        margin: 0;
        padding: 14px 0;
        font-family: var(--mono);
        font-size: 12px;
        line-height: 18px;
    }

    .gutter {
        flex-shrink: 0;
        padding-right: 12px;
        padding-left: 16px;
        color: var(--muted);
        opacity: 0.6;
        text-align: right;
        user-select: none;
    }

    .source {
        flex: 1;
        min-width: 0;
        padding-right: 16px;
        padding-left: 14px;
        overflow-x: auto;
        color: var(--text);
    }

    .source :global(mark.hit) {
        border-radius: 3px;
        background: color-mix(in srgb, var(--possible) 22%, transparent);
        color: inherit;
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--possible) 60%, transparent);
    }

    /* Found by name: dashed, as less certain. */
    .source :global(mark.hit.search) {
        background: color-mix(in srgb, var(--possible) 10%, transparent);
        box-shadow: none;
        outline: 1px dashed color-mix(in srgb, var(--possible) 70%, transparent);
    }

    .source :global(mark.hit.current) {
        background: color-mix(in srgb, var(--possible) 45%, transparent);
        box-shadow: 0 0 0 2px var(--possible);
    }
</style>
