<script lang="ts">
    import RequestLines from '../components/RequestLines.svelte';
    import { plural } from '../format';
    import type { CnameDetail } from '../model';

    let { aliases }: { aliases: CnameDetail[] } = $props();
</script>

{#if aliases.length === 0}
    <p class="empty">No address of this site points to another company so far.</p>
{/if}

{#each aliases as alias (alias.host)}
    <div class="card">
        <div class="host">{alias.host}</div>
        <p class="line">Really leads to <strong>{alias.targetSite}</strong></p>
        <p class="chain">{[...alias.via, alias.target].join(' → ')}</p>
        <div class="count">{plural(alias.requests.length, 'request')}</div>
        <RequestLines requests={alias.requests} />
    </div>
{/each}

<style>
    .host {
        font-weight: 600;
        word-break: break-all;
    }

    .line {
        margin: 6px 0 0;
        font-size: 12px;
    }

    .chain {
        margin: 2px 0 0;
        color: var(--muted);
        font-size: 12px;
        word-break: break-all;
    }

    .count {
        margin-top: 12px;
        color: var(--muted);
        font-size: 12px;
    }

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
