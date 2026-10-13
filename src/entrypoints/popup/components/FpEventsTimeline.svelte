<script lang="ts">
    import type { FpMonkeyEvent } from '@/types/events';
    import { fmtTimeMs, isNum } from '../format';

    let { events }: { events: FpMonkeyEvent[] } = $props();

    // Sort by timestamp asc (keep stable order if timestamps missing)
    const sorted = $derived(
        [...events].sort((a, b) => {
            const at = isNum(a?.timeStamp) ? a.timeStamp : Number.POSITIVE_INFINITY;
            const bt = isNum(b?.timeStamp) ? b.timeStamp : Number.POSITIVE_INFINITY;
            if (at !== bt) return at - bt;
            return a.id.localeCompare(b.id);
        })
    );
</script>

<div>
    <div class="sectionTitle">Fingerprint events</div>

    {#if sorted.length === 0}
        <div class="state">No fingerprint events recorded for this spike.</div>
    {:else}
        <div class="fpTimeline">
            {#each sorted as ev, i (i)}
                <div class="fpTimelineItem">
                    <div class="fpTime mono">{fmtTimeMs(ev?.timeStamp)}</div>
                    <div class="fpArrow"></div>
                    <div class="fpEvent mono">{ev.id}</div>
                </div>
            {/each}
        </div>
    {/if}
</div>
