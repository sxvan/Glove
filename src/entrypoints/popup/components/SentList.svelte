<script lang="ts">
    // The requests with data a script sent right after reading, one row per request, the most data
    // first, like the stored values (see StoredList): its method and where it went, how much
    // and when, through which alias if any, the names of its parameters, and how it was sent; on the
    // page's own screen also the script that sent it.
    import { bytes } from '../format';
    import type { SentRequest } from '../model';
    import MiddleTruncate from './MiddleTruncate.svelte';

    let { requests }: { requests: SentRequest[] } = $props();

    const HOW: Record<NonNullable<SentRequest['how']>, string> = {
        fetch: 'By fetch',
        xhr: 'By XMLHttpRequest',
        beacon: 'By sendBeacon, which is sent even as the page closes',
        image: 'As an image, a tracking pixel',
    };

    /** The size, and when: "4.1 KB · 120 ms after reading", "· while reading". */
    function sizeAndWhen(request: SentRequest): string {
        const when = request.afterMs === null ? '' : request.afterMs === 0 ? ' · while reading' : ` · ${Math.round(request.afterMs)} ms after reading`;
        return `${bytes(request.bytes)}${when}`;
    }
</script>

<ul class="sent">
    <!-- By position: the same address can be sent twice, with another method. -->
    {#each requests as request, i (i)}
        <li>
            <span class="title" title={request.url}>
                <span class="tag">{request.method}</span>
                <span class="path"><MiddleTruncate text={request.path} path /></span>
            </span>
            <span class="meta">{request.site} · {sizeAndWhen(request)}</span>
            {#if request.via}<span class="meta">Through {request.via}, an address of the site that is an alias (CNAME) for it</span>{/if}
            {#if request.params.length > 0}
                <span class="meta params" title={request.params.join(', ')}>{request.params.length === 1 ? 'Parameter' : 'Parameters'}: <span class="names">{request.params.join(', ')}</span></span>
            {/if}
            {#if request.how}<span class="meta">{HOW[request.how]}</span>{/if}
            <!-- One line per script, named like its card (see StoredList). -->
            {#each request.by ?? [] as script (script.url)}
                <span class="meta by" title={script.url}><span>By</span><MiddleTruncate text={script.name} path={script.path} plain /><span class="origin">· {script.origin}</span></span>
            {/each}
        </li>
    {/each}
</ul>

<style>
    .sent {
        display: grid;
        gap: 14px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    li {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    /* Its method, then the path, as a request starts: "POST /collect". The path takes the rest of the
       line, shortened in the middle when that's too little: sized by its own text, it would shorten
       itself further once the bundled font, wider than the fallback, has loaded. */
    .title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .path {
        min-width: 0;
        flex: 1 1 0;
        font-family: var(--mono);
        font-size: 13px;
        font-weight: 600;
    }

    /* Like the stored values' tags, in the muted color: a method is a fact, not a judgment. */
    .tag {
        flex: none;
        padding: 0 6px;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 600;
        line-height: 16px;
    }

    .meta {
        color: var(--muted);
        font-size: 12px;
    }

    /* The parameters' names, on one line: what a request carries, written like a stored value. */
    .params {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .names {
        font-family: var(--mono);
    }

    .by {
        display: flex;
        gap: 4px;
        min-width: 0;
        white-space: nowrap;
    }

    .by > :global(.truncate) {
        flex: 0 1 auto;
    }

    .origin {
        flex: none;
    }
</style>
