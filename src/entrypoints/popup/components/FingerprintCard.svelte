<script lang="ts">
    import type { MetricsSnapshot, ScriptSnapshot } from '@/types/snapshot';
    import { fmtSeconds, humanFpSentence, isNum, safeLen, type DotState } from '../format';
    import Card from './Card.svelte';
    import MetricsRows from './MetricsRows.svelte';
    import ScriptItem from './ScriptItem.svelte';

    const SCRIPT_LIMIT = 3;

    let {
        loaded,
        metrics,
        scripts,
    }: {
        /** False until the first snapshot has arrived; placeholders are shown until then. */
        loaded: boolean;
        metrics: MetricsSnapshot | null;
        scripts: ScriptSnapshot[];
    } = $props();

    let showAllScripts = $state(false);

    const intensity = $derived(metrics?.intensity ?? 0);
    const score = $derived(metrics?.score);

    const dot = $derived.by((): DotState | undefined => {
        if (!loaded) return undefined;
        if (isNum(score) && score >= 0.7) return 'bad';
        if (isNum(score) && score < 0.4 && intensity > 0) return 'good';
        return intensity > 0 ? 'warn' : 'muted';
    });

    const badge = $derived(!loaded ? '—' : isNum(score) ? `score ${score.toFixed(2)}` : intensity > 0 ? 'detected' : 'none');

    const durationSec = $derived(fmtSeconds(metrics?.durationMs));

    // Sort by score desc, fallback intensity
    const sortedScripts = $derived(
        [...scripts].sort((a, b) => {
            const as = a?.fpMetrics?.score ?? -1;
            const bs = b?.fpMetrics?.score ?? -1;
            if (bs !== as) return bs - as;
            return (b?.fpMetrics?.intensity ?? 0) - (a?.fpMetrics?.intensity ?? 0);
        })
    );
    const visibleScripts = $derived(showAllScripts ? sortedScripts : sortedScripts.slice(0, SCRIPT_LIMIT));
</script>

<Card id="fpAccordion" title="Fingerprinting" {dot} {badge}>
    {#snippet stats()}
        <span><b>{loaded ? String(intensity) : '—'}</b> events</span>
        <span><b>{loaded ? (durationSec === '—' ? '0' : durationSec) : '—'}</b> sec</span>
        <span><b>{loaded ? safeLen(metrics?.distinctFpApis) : '—'}</b> APIs</span>
        <span><b>{loaded ? safeLen(metrics?.distinctFpCategories) : '—'}</b> categories</span>
    {/snippet}

    <p class="sentence">
        {#if !loaded}
            —
        {:else if !metrics}
            <span class="muted">No document metrics available.</span>
        {:else}
            {humanFpSentence(metrics)}
        {/if}
    </p>

    <details class="miniDetails">
        <summary>
            <div class="miniTitle">Metrics</div>
            <div class="chev" aria-hidden="true"></div>
        </summary>
        <div class="miniBody">
            {#if loaded}
                <MetricsRows {metrics} />
            {:else}
                <div class="list"></div>
            {/if}
        </div>
    </details>

    <div class="sectionTitle">Scripts</div>
    <div aria-label="Fingerprinting scripts list">
        {#if loaded && scripts.length === 0}
            <div class="state">No scripts detected.</div>
        {/if}
        {#each visibleScripts as script (script.name)}
            <ScriptItem {script} />
        {/each}
    </div>

    {#if sortedScripts.length > SCRIPT_LIMIT}
        <button class="toggleBtn" style="display:block;" type="button" onclick={() => (showAllScripts = !showAllScripts)}>
            {showAllScripts ? 'Show less' : `Show all scripts (${sortedScripts.length})`}
        </button>
    {/if}
</Card>
