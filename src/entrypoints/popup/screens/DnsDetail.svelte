<script lang="ts">
    import LikelihoodLabel from '../components/LikelihoodLabel.svelte';
    import RequestLines from '../components/RequestLines.svelte';
    import { plural } from '../format';
    import type { HostnameDetail } from '../model';

    let { hosts }: { hosts: HostnameDetail[] } = $props();
</script>

{#if hosts.length === 0}
    <p class="empty">No request went to a hostname that looks like it contains an ID so far.</p>
{/if}

{#each hosts as host (host.host)}
    <div class="card">
        <div class="row">
            <span class="host">{host.host}</span>
            <LikelihoodLabel likelihood={host.likelihood} />
        </div>
        <div class="meta">Randomness score {host.score.toFixed(2)} · {plural(host.requests.length, 'request')}</div>
        <RequestLines requests={host.requests} />
    </div>
{/each}

<style>
    .row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
    }

    .host {
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 600;
        word-break: break-all;
    }

    .meta {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
    }

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
