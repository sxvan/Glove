<script lang="ts">
    import type { SpikeSnapshot } from '@/types/snapshot';
    import { getSpikeMetrics, isNum, metricsSummary, scoreClass } from '../format';
    import CorrelatedHttpList from './CorrelatedHttpList.svelte';
    import FpEventsTimeline from './FpEventsTimeline.svelte';

    let { spike, index }: { spike: SpikeSnapshot | null; index: number } = $props();

    const score = $derived(spike?.fpMetrics?.score);
</script>

<details class="spikeDetails">
    <summary>
        <div class="spikeLeft">
            <div class="spikeTitle">Spike #{index + 1}</div>
            <div class="spikeMeta">{metricsSummary(getSpikeMetrics(spike))}</div>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
            {#if isNum(score)}
                <div class="score {scoreClass(score)}">{score.toFixed(2)}</div>
            {/if}
            <div class="chev" aria-hidden="true"></div>
        </div>
    </summary>

    <div class="spikeBody">
        <CorrelatedHttpList correlations={spike?.httpCorrelations ?? []} />
        <FpEventsTimeline events={spike?.events ?? []} />
    </div>
</details>
