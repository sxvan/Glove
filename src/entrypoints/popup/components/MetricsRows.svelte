<script lang="ts">
    import { fmtSeconds, isNum, type Metrics } from '../format';
    import Rows from './Rows.svelte';

    let { metrics }: { metrics: Metrics | null } = $props();

    const rows = $derived<[string, string][]>([
        ['intensity', String(metrics?.intensity ?? '—')],
        ['density', isNum(metrics?.density) ? metrics.density.toFixed(2) : '—'],
        ['duration', `${fmtSeconds(metrics?.durationMs)} sec`],
    ]);
</script>

<Rows {rows} />
