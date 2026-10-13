<script lang="ts">
    import type { HttpRequest } from '@/types/analysis';
    import {
        clamp01,
        dnsScoreClass,
        fmtScore,
        fmtTime,
        getPathFromUrl,
        groupBy,
        isNum,
        maxSubdomainScore,
        presentRows,
        withUniqueKeys,
        type DotState,
    } from '../format';
    import Card from './Card.svelte';
    import Rows from './Rows.svelte';

    // Only requests above this subdomain score count as detected.
    const DETECTION_THRESHOLD = 0.2;

    let { loaded, requests }: { loaded: boolean; requests: HttpRequest[] } = $props();

    const detected = $derived(requests.filter((r) => (r?.subdomainScore ?? 0) > DETECTION_THRESHOLD));
    const maxScore = $derived(maxSubdomainScore(detected));

    // Grouped by hostname, highest-scoring domain first; requests by score, then newest first.
    const domains = $derived(
        [...groupBy(detected, (r) => r?.hostname || '(unknown)')]
            .map(([domain, reqs]) => ({
                domain,
                maxScore: maxSubdomainScore(reqs),
                requests: withUniqueKeys(
                    [...reqs].sort((a, b) => {
                        const as = a?.subdomainScore ?? -1;
                        const bs = b?.subdomainScore ?? -1;
                        if (bs !== as) return bs - as;
                        return (b?.timeStamp ?? 0) - (a?.timeStamp ?? 0);
                    }),
                    (r) => `${r?.timeStamp ?? 0}:${r?.url ?? ''}`
                ),
            }))
            .sort((a, b) => b.maxScore - a.maxScore)
    );

    const dot = $derived<DotState | undefined>(!loaded ? undefined : detected.length === 0 ? 'good' : maxScore > 0.6 ? 'bad' : 'warn');
    const badge = $derived(!loaded ? '—' : detected.length === 0 ? 'none' : `max ${clamp01(maxScore)!.toFixed(2)}`);

    function requestRows(req: HttpRequest, score: number | null): [string, string][] {
        return presentRows([
            ['Score', isNum(score) ? score.toFixed(3) : '—'],
            ['Method', req?.method],
            ['URL', req?.url],
            ['Hostname', req?.hostname],
            ['Document URL', req?.documentUrl],
            ['Type', req?.type],
            ['Cross-origin', String(!!req?.isCrossOrigin)],
            ['Cross-host', String(!!req?.isCrossHost)],
        ]);
    }
</script>

<Card id="dnsAccordion" title="DNS tracking" {dot} {badge}>
    {#snippet stats()}
        <span><b>{loaded ? domains.length : '—'}</b> domains</span>
        <span><b>{loaded ? detected.length : '—'}</b> requests</span>
    {/snippet}

    <div>
        {#if loaded && detected.length === 0}
            <div class="state">No DNS tracking detected (score > {DETECTION_THRESHOLD}).</div>
        {/if}

        {#each domains as { domain, maxScore: domainMax, requests: domainRequests } (domain)}
            {@const domainScore = clamp01(domainMax)}
            <details class="dnsDomainDetails">
                <summary>
                    <div class="dnsLeft">
                        <div class="dnsTitle">{domain || '(unknown domain)'}</div>
                        <div class="dnsMeta">{domainRequests.length} requests</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div class="score {dnsScoreClass(domainScore)}">{fmtScore(domainScore)}</div>
                        <div class="chev" aria-hidden="true"></div>
                    </div>
                </summary>

                <div class="accBody">
                    {#each domainRequests as { item: req, key } (key)}
                        {@const score = clamp01(req?.subdomainScore)}
                        <details class="dnsReqDetails">
                            <summary>
                                <div class="dnsLeft">
                                    <div class="dnsReqTitle" title={req?.url ?? ''}>{(req?.method || 'REQ').toUpperCase()} {getPathFromUrl(req?.url)}</div>
                                    <div class="dnsMeta">{req?.type ?? '—'} · {fmtTime(req?.timeStamp)}</div>
                                </div>
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <div class="score {dnsScoreClass(score)}">{fmtScore(score)}</div>
                                    <div class="chev" aria-hidden="true"></div>
                                </div>
                            </summary>

                            <div class="dnsReqBody">
                                <Rows rows={requestRows(req, score)} withTitles />
                            </div>
                        </details>
                    {/each}
                </div>
            </details>
        {/each}
    </div>
</Card>
