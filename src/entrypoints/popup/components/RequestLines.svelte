<script lang="ts">
    import type { RequestLine } from '../model';
    import MiddleTruncate from './MiddleTruncate.svelte';

    const SHOWN = 3;

    let { requests }: { requests: RequestLine[] } = $props();
</script>

<ul>
    {#each requests.slice(0, SHOWN) as req, i (i)}
        <li title={req.path}><span class="method">{req.method}</span><MiddleTruncate text={req.path} path plain /></li>
    {/each}
    {#if requests.length > SHOWN}
        <li class="more">and {requests.length - SHOWN} more</li>
    {/if}
</ul>

<style>
    ul {
        display: grid;
        gap: 4px;
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
        font-family: var(--mono);
        font-size: 12px;
        color: var(--muted);
    }

    /* Method, then the path shortened in the middle keeping its file name (see MiddleTruncate). */
    li {
        display: flex;
        gap: 1ch;
        min-width: 0;
        white-space: nowrap;
    }

    .method {
        flex-shrink: 0;
        color: var(--text);
    }

    .more {
        font-family: var(--font);
    }
</style>
