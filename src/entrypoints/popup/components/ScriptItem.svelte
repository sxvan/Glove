<script lang="ts">
    import type { ScriptSnapshot } from '@/types/snapshot';
    import { fmtScore, humanFpSentence, metricsSummary, scoreClass, withUniqueKeys, type Metrics } from '../format';
    import MetricsRows from './MetricsRows.svelte';
    import SpikeItem from './SpikeItem.svelte';

    let { script }: { script: ScriptSnapshot } = $props();

    const name = $derived(script?.name ?? '(unknown script)');
    const metrics = $derived<Metrics>(script?.fpMetrics ?? {});

    // Spikes are recomputed on every analysis; their first event identifies them across updates,
    // so an open spike stays open when the list is re-sorted.
    const spikes = $derived(
        withUniqueKeys(
            [...(script?.fpSpikes ?? [])].sort((a, b) => {
                const as = a?.fpMetrics?.score ?? -1;
                const bs = b?.fpMetrics?.score ?? -1;
                if (bs !== as) return bs - as;

                // fallback if no score
                const ai = a?.fpMetrics?.intensity ?? a?.events?.length ?? 0;
                const bi = b?.fpMetrics?.intensity ?? b?.events?.length ?? 0;
                return bi - ai;
            }),
            (spike) => `${spike?.events?.[0]?.timeStamp}:${spike?.events?.[0]?.id}`
        )
    );
</script>

<details class="scriptDetails">
    <summary>
        <div class="scriptSummaryLeft">
            <div class="scriptName" title={name}>{name}</div>
            <div class="scriptSub">{metricsSummary(metrics)}</div>
        </div>

        <div class="scriptRight">
            <div class="score {scoreClass(metrics?.score)}">{fmtScore(metrics?.score)}</div>
            <div class="chev" aria-hidden="true"></div>
        </div>
    </summary>

    <div class="scriptBody">
        <p class="sentence">{humanFpSentence(metrics)}</p>

        <details class="miniDetails">
            <summary>
                <div class="miniTitle">Metrics</div>
                <div class="chev" aria-hidden="true"></div>
            </summary>
            <div class="miniBody">
                <MetricsRows {metrics} />
            </div>
        </details>

        <div>
            <div class="sectionTitle">Spikes</div>

            {#if spikes.length === 0}
                <div class="state">No spikes detected.</div>
            {:else}
                {#each spikes as { item, key }, index (key)}
                    <SpikeItem spike={item} {index} />
                {/each}
            {/if}
        </div>
    </div>
</details>
