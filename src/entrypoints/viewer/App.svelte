<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { js_beautify } from 'js-beautify/js/lib/beautify.js';
    import { parseViewerQuery, type ViewerApi } from '@/lib/script-viewer';
    import MiddleTruncate from '../popup/components/MiddleTruncate.svelte';
    import { plural } from '../popup/format';
    import { highlightWithLocations } from './highlight';
    import { inlineScripts } from './inline-scripts';
    import { locateApis, type CodeLocation } from './locations';

    // Larger sources are shown formatted but without highlighting, which would take too long.
    const MAX_HIGHLIGHT_CHARS = 3_000_000;

    type Status = 'loading' | 'formatting' | 'ready' | 'error';

    /** Code shown with its marks: the script, or each of a page's inline scripts. */
    interface CodeBlock {
        /** Empty for a script file. */
        title: string;
        detail: string;
        code: string;
        /** Empty when the code is too large to highlight. */
        html: string;
        locations: CodeLocation[];
    }

    const params = parseViewerQuery(location.search);

    let status = $state<Status>('loading');
    let error = $state('');
    let blocks = $state<CodeBlock[]>([]);
    // False when recorded positions couldn't be matched to the downloaded code.
    let exactAvailable = $state(true);
    let current = $state(-1);

    // All marks in the order they're numbered.
    const locations = $derived(blocks.flatMap((block) => block.locations));

    /** Per API: how many places are marked and whether they are recorded positions or search results. */
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

    onMount(async () => {
        if (!params) {
            fail('This page needs the address of a script or page (http or https) to show.');
            return;
        }

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
    });

    /** Formats `source` and marks the APIs' calls in it, numbering the marks from `firstId` on. */
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

    /** Jumps to the next location of `api` after the current one, wrapping around. */
    function goToApi(api: string) {
        const after = locations.findIndex((l, i) => i > current && l.apis.includes(api));
        const index = after !== -1 ? after : locations.findIndex((l) => l.apis.includes(api));
        if (index !== -1) goTo(index);
    }
</script>

<header>
    <div class="title">
        <h1 title={params?.name}><MiddleTruncate text={params?.name ?? 'Script viewer'} path={!!params && !params.inline} /></h1>
        {#if params}
            <a class="original" href={params.url} title={params.url} target="_blank" rel="noopener noreferrer"
                ><MiddleTruncate text={params.url} path plain /><span class="arrow">&nbsp;↗</span></a
            >
        {/if}
    </div>

    {#if status === 'ready' && locations.length > 0}
        <nav aria-label="Fingerprinting locations">
            <button type="button" onclick={() => goTo(current - 1)}>Previous</button>
            <span class="position">{current === -1 ? '–' : current + 1} of {locations.length}</span>
            <button type="button" onclick={() => goTo(current + 1)}>Next</button>
        </nav>
    {/if}
</header>

{#if status === 'loading'}
    <p class="state">Downloading the script…</p>
{:else if status === 'formatting'}
    <p class="state">Formatting the script…</p>
{:else if status === 'error'}
    <p class="state error">{error}</p>
{:else}
    {#if params && params.apis.length > 0}
        <section class="apis" aria-label="Fingerprinting APIs used by this script">
            {#each params.apis as api (api.id)}
                {@const { count, exact } = found.get(api.id) ?? { count: 0, exact: false }}
                <button type="button" class="api" class:search={count > 0 && !exact} disabled={count === 0} onclick={() => goToApi(api.id)}>
                    <span class="api-name">{api.id}</span>
                    <span class="api-meta">
                        {#if api.calls !== null}{plural(api.calls, 'call')}{' · '}{/if}{count === 0
                            ? 'not found in the code'
                            : exact
                              ? plural(count, 'place')
                              : `found ${count}× by name`}
                    </span>
                </button>
            {/each}
        </section>
        <div class="note">
            {#if hasExact}
                <p>Marked places are where the page called each API, recorded from its call stack.</p>
            {/if}
            {#if generated}
                <p>
                    Some calls come from code the script generates while it runs (with new Function or eval). They are marked where
                    that code is generated.
                </p>
            {/if}
            {#if hasSearch}
                <p>
                    APIs without recorded positions are found by searching for their names (dashed outline), which misses calls
                    hidden by obfuscation.
                </p>
            {/if}
            {#if hadPositions && !exactAvailable}
                <p class="warning">The recorded positions couldn't be matched to this copy of the script, so names are searched instead.</p>
            {/if}
            {#if unconfirmed > 0}
                <p class="warning">
                    {plural(unconfirmed, 'recorded position')} {unconfirmed === 1 ? "doesn't" : "don't"} land on the expected API. The
                    server probably sent a different version of the script than the one that ran.
                </p>
            {/if}
            {#if params.inline}
                <p>
                    The page was downloaded again, without cookies, to show the inline scripts the calls came from. A page that
                    changes per visit or login may not match the version that ran.
                </p>
            {:else}
                <p>The script was downloaded again, without cookies, to show it here.</p>
            {/if}
        </div>
    {/if}

    {#each blocks as block, i (i)}
        {#if block.title}
            <h2>{block.title}</h2>
            <p class="block-detail">{block.detail}</p>
        {/if}
        {#if !block.html}
            <p class="note">This script is too large to highlight; it is shown formatted only.</p>
        {/if}

        <div class="code">
            <pre class="gutter" aria-hidden="true">{lineNumbers(block.code)}</pre>
            {#if block.html}
                <pre class="source hljs"><code>{@html block.html}</code></pre>
            {:else}
                <pre class="source hljs"><code>{block.code}</code></pre>
            {/if}
        </div>
    {/each}
{/if}

<style>
    header {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 20px;
        border-bottom: 1px solid var(--border);
        background: var(--bg);
    }

    .title {
        min-width: 0;
    }

    h1 {
        margin: 0;
        font-size: 16px;
    }

    /* The script's URL, shortened in the middle keeping its file name (see MiddleTruncate), then ↗. */
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

    nav {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 8px;
    }

    nav button,
    .api {
        padding: 5px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        cursor: pointer;
    }

    nav button:hover,
    .api:not(:disabled):hover {
        border-color: var(--muted);
    }

    .position {
        min-width: 70px;
        color: var(--muted);
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    .apis {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 14px 20px 0;
    }

    .api {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
    }

    .api:disabled {
        cursor: default;
        opacity: 0.55;
    }

    /* Found by name rather than recorded, like their dashed marks in the code. */
    .api.search {
        border-style: dashed;
    }

    .note p {
        margin: 0 0 2px;
    }

    .warning {
        color: var(--possible);
    }

    .api-name {
        font-family: var(--mono);
        font-size: 12px;
    }

    .api-meta {
        color: var(--muted);
        font-size: 12px;
    }

    .note,
    .state {
        margin: 10px 20px 0;
        color: var(--muted);
        font-size: 12px;
    }

    .state {
        margin-top: 20px;
        font-size: 13px;
    }

    .error {
        color: var(--likely);
    }

    h2 {
        margin: 24px 20px 0;
        font-size: 14px;
    }

    .block-detail {
        margin: 2px 20px 0;
        color: var(--muted);
        font-size: 12px;
    }

    .code {
        display: flex;
        margin: 14px 20px 20px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        overflow: hidden;
    }

    pre {
        margin: 0;
        padding: 12px 0;
        font-family: var(--mono);
        font-size: 12px;
        line-height: 18px;
    }

    .gutter {
        flex-shrink: 0;
        padding-right: 12px;
        padding-left: 12px;
        border-right: 1px solid var(--border);
        color: var(--muted);
        opacity: 0.6;
        text-align: right;
        user-select: none;
    }

    .source {
        flex: 1;
        min-width: 0;
        padding-left: 14px;
        overflow-x: auto;
        background: none;
    }

    /* Locations of fingerprinting APIs, and the one navigated to. */
    /* Search results: dashed outline, as they are less certain than recorded positions. */
    .source :global(mark.hit.search) {
        background: rgb(242 138 60 / 0.12);
        box-shadow: none;
        outline: 1px dashed rgb(242 138 60 / 0.7);
    }

    .source :global(mark.hit) {
        border-radius: 3px;
        background: rgb(242 138 60 / 0.25);
        color: inherit;
        box-shadow: 0 0 0 1px rgb(242 138 60 / 0.6);
    }

    .source :global(mark.hit.current) {
        background: rgb(242 138 60 / 0.55);
        box-shadow: 0 0 0 2px var(--possible);
    }
</style>
