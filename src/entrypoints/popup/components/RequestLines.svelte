<script lang="ts">
    import type { RequestLine } from '../model';

    const SHOWN = 3;

    let { requests }: { requests: RequestLine[] } = $props();
</script>

<ul>
    {#each requests.slice(0, SHOWN) as req, i (i)}
        <li><span class="method">{req.method}</span> {req.path}</li>
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

    li {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .method {
        color: var(--text);
    }

    .more {
        font-family: var(--font);
    }
</style>
