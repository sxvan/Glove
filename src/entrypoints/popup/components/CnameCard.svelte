<script lang="ts">
    import type { HttpRequest } from '@/types/analysis';
    import { fmtTime, getHostFromUrl, groupBy, importantRequestFields, requestTitle, withUniqueKeys, type DotState } from '../format';
    import Card from './Card.svelte';
    import Rows from './Rows.svelte';

    let { loaded, requests }: { loaded: boolean; requests: HttpRequest[] } = $props();

    // Grouped by host, most requests first; requests within a domain newest first.
    const domains = $derived(
        [...groupBy(requests, (r) => getHostFromUrl(r?.url) || '(unknown)')]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([domain, reqs]) => ({
                domain,
                requests: withUniqueKeys(
                    [...reqs].sort((a, b) => (b?.timeStamp ?? 0) - (a?.timeStamp ?? 0)),
                    (r) => `${r?.requestId}:${r?.url}`
                ),
            }))
    );

    const dot = $derived<DotState | undefined>(!loaded ? undefined : requests.length === 0 ? 'good' : 'warn');
    const badge = $derived(!loaded ? '—' : requests.length === 0 ? 'none' : 'detected');
</script>

<Card id="cnameAccordion" title="CNAME cloaking" {dot} {badge}>
    {#snippet stats()}
        <span><b>{loaded ? domains.length : '—'}</b> domains</span>
        <span><b>{loaded ? requests.length : '—'}</b> requests</span>
    {/snippet}

    <div>
        {#if loaded && requests.length === 0}
            <div class="state">No CNAME cloaking requests detected.</div>
        {/if}

        {#each domains as { domain, requests: domainRequests } (domain)}
            <details class="cnameDomainDetails">
                <summary>
                    <div class="cnameLeft">
                        <div class="cnameTitle">{domain || '(unknown domain)'}</div>
                        <div class="cnameMeta">{domainRequests.length} requests</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div class="chev" aria-hidden="true"></div>
                    </div>
                </summary>

                <div class="accBody">
                    {#each domainRequests as { item: req, key } (key)}
                        <details class="cnameReqDetails">
                            <summary>
                                <div class="cnameLeft">
                                    <div class="cnameTitle">{requestTitle(req)}</div>
                                    <div class="cnameMeta">{fmtTime(req?.timeStamp)}</div>
                                </div>
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <div class="chev" aria-hidden="true"></div>
                                </div>
                            </summary>

                            <div class="cnameReqBody">
                                <div class="cnameUrl" title={req?.url ?? ''}>{req?.url ?? ''}</div>
                                <Rows rows={importantRequestFields(req)} withTitles style="margin-top: 10px;" />
                            </div>
                        </details>
                    {/each}
                </div>
            </details>
        {/each}
    </div>
</Card>
