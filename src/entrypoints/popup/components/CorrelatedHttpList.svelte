<script lang="ts">
    import type { HttpConsolidatedEvent } from '@/types/analysis';
    import { clamp01, fmtDelta, fmtScore, safeUrlParts, scoreClass } from '../format';

    let { correlations }: { correlations: HttpConsolidatedEvent[] } = $props();

    const items = $derived(
        [...correlations]
            .sort((a, b) => {
                const as = a?.suspicionScore ?? -1;
                const bs = b?.suspicionScore ?? -1;
                if (bs !== as) return bs - as;

                // fallback: smaller time delta is "tighter" correlation
                const ad = a?.timeDeltaMs ?? Number.POSITIVE_INFINITY;
                const bd = b?.timeDeltaMs ?? Number.POSITIVE_INFINITY;
                return ad - bd;
            })
            .map((c) => {
                const url = c?.httpRequest?.url ?? c?.httpEvent?.requestUrl ?? '';
                const method = c?.httpRequest?.method ?? c?.httpEvent?.method ?? '';
                return {
                    ...safeUrlParts(url),
                    method: (method || 'REQ').toUpperCase(),
                    meta: `Δt ${fmtDelta(c?.timeDeltaMs)} · api: ${c?.httpEvent?.id ?? '—'} · credentials: ${c?.httpEvent?.credentials ?? '—'}`,
                    score: clamp01(c?.suspicionScore),
                };
            })
    );
</script>

<div>
    <div class="sectionTitle">Correlated HTTP events</div>

    {#if items.length === 0}
        <div class="state">No correlated HTTP events.</div>
    {:else}
        <div class="httpList">
            {#each items as item, i (i)}
                <div class="httpItem">
                    <div class="httpLeft">
                        <!-- Inline flow: the spaces between the spans are part of the layout. -->
                        <div class="httpTitle"><span class="mono">{item.method}</span>{#if item.host}{' '}<span class="mono">{item.host}</span>{/if}{#if item.path}{' '}<span class="mono httpPath">{item.path}</span>{/if}</div>
                        <div class="httpMeta">{item.meta}</div>
                    </div>
                    <div class="score {scoreClass(item.score)}">{fmtScore(item.score)}</div>
                </div>
            {/each}
        </div>
    {/if}
</div>
