<script lang="ts">
    import { viewerUrl } from '@/lib/script-viewer';
    import LikelihoodLabel from '../components/LikelihoodLabel.svelte';
    import ScoreBreakdown from '../components/ScoreBreakdown.svelte';
    import SignalLine from '../components/SignalLine.svelte';
    import { duration, plural } from '../format';
    import type { PageScore, ScriptDetail } from '../model';

    let { page, scripts }: { page: PageScore; scripts: ScriptDetail[] } = $props();

    const hostCount = (script: ScriptDetail) => script.contacted.reduce((n, s) => n + s.hosts.length, 0);

    function partyTitle(script: ScriptDetail): string {
        if (script.aliasOf) return `Served from ${script.origin}, which is an alias (CNAME) for ${script.aliasOf}`;
        if (script.party === 'first') return "Loaded from the site's own domain";
        if (script.party === 'third') return 'Loaded from another domain';
        return '';
    }
</script>

{#if scripts.length === 0}
    <p class="empty">No script on this page has read identifying device details so far.</p>
{:else}
    <div class="card">
        <ScoreBreakdown label="Page" score={page.score} tree={page.tree} />
    </div>
{/if}

{#each scripts as script (script.key)}
    <div class="card">
        <!-- Who: two rows with a right column, name | likelihood over origin | party. -->
        <div class="head">
            {#if script.viewer}
                <a class="name link" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer">
                    {script.name}
                </a>
            {:else}
                <span class="name" title={script.url}>{script.name}</span>
            {/if}
            <LikelihoodLabel likelihood={script.likelihood} />

            <span class="facts" title={script.origin}>{script.origin}</span>
            <span class="party" title={partyTitle(script)}>
                {script.party === 'first' ? '1st party' : script.party === 'third' ? '3rd party' : ''}
            </span>
        </div>

        <div class="score">
            <ScoreBreakdown score={script.score} tree={script.tree} />
        </div>

        {#if script.signals.length > 0}
            <ul class="signals" aria-label="Signals">
                {#each script.signals as signal (signal.id)}
                    <SignalLine text={signal.text} />
                {/each}
            </ul>
        {/if}

        <!-- What it did: a label column and a value column. Opened lists span the full width. -->
        <div class="rows">
            <div class="label">Read</div>
            <div class="value">{script.techniques.join(', ')}</div>
            {#if script.apis.length > 0}
                <details class="more">
                    <summary>{plural(script.apis.length, 'fingerprinting API')} · {plural(script.calls, 'call')}</summary>
                    <ul class="apis">
                        {#each script.apis as api (api.id)}
                            <li>
                                <span>{api.id}</span>
                                {#if api.calls !== null}<span class="calls" title={plural(api.calls, 'call')}>{api.calls}</span>{/if}
                            </li>
                        {/each}
                    </ul>
                </details>
            {/if}

            {#if script.burst}
                <div class="label">Burst</div>
                <div class="value">{plural(script.burst.apis, 'different fingerprinting API')} within {duration(script.burst.durationMs)}</div>
            {/if}

            {#if script.contacted.length > 0}
                <div class="label">Contacted</div>
                <div class="value">
                    {#each script.contacted as { site, hosts }, i (site)}
                        {#if i > 0}{', '}{/if}<span class="site">{site}</span>{#if hosts.length > 1}&nbsp;<span class="count">({hosts.length} servers)</span>{/if}
                    {/each}
                    <span class="note">right after reading</span>
                </div>
                {#if hostCount(script) > script.contacted.length}
                    <details class="more">
                        <summary>{plural(hostCount(script), 'address', 'addresses')}</summary>
                        {#each script.contacted as { site, hosts } (site)}
                            <ul>
                                {#each hosts as host (host)}<li>{host}</li>{/each}
                            </ul>
                        {/each}
                    </details>
                {/if}
            {/if}
        </div>
    </div>
{/each}

<style>
    /* Two rows with a right column: name | likelihood, then origin | party, each on a shared baseline. */
    .head {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: baseline;
        gap: 2px 10px;
    }

    /* At most two lines, so a long path can't take over the card; the tooltip has the full URL. */
    .name {
        display: -webkit-box;
        min-width: 0;
        overflow: hidden;
        font-size: 14px;
        font-weight: 600;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
    }

    .head :global(.label) {
        text-align: right;
    }

    .party {
        color: var(--muted);
        font-size: 12px;
        text-align: right;
        white-space: nowrap;
    }

    /* The title links to the script viewer; underlined on hover. */
    .link {
        color: inherit;
        text-decoration: none;
        text-underline-offset: 3px;
    }

    .link:hover {
        text-decoration: underline;
    }

    .facts {
        min-width: 0;
        overflow: hidden;
        color: var(--muted);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .score {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--border);
    }

    /* Signs that the script hides what it does. */
    .signals {
        display: grid;
        gap: 6px;
        margin: 10px 0 0;
        padding: 10px 0 0;
        border-top: 1px solid var(--border);
        list-style: none;
    }

    .rows {
        --label-width: 72px;
        --column-gap: 8px;
        display: grid;
        grid-template-columns: var(--label-width) 1fr;
        gap: 10px var(--column-gap);
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--border);
        font-size: 12px;
    }

    .label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        line-height: 17px;
        text-transform: uppercase;
    }

    .value {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    /* A row's details toggle: spans the full width so long names fit; the toggle lines up with the values. */
    .more {
        grid-column: 1 / -1;
        margin-top: -6px;
    }

    .more summary {
        margin-left: calc(var(--label-width) + var(--column-gap));
    }

    .site {
        font-weight: 600;
    }

    .count,
    .note {
        color: var(--muted);
    }

    details {
        margin-top: 4px;
    }

    summary {
        color: var(--muted);
        cursor: pointer;
    }

    summary:hover {
        color: var(--text);
    }

    /* The opened lists of APIs and servers. No bullets, so long names such as
       intl.datetimeformat.resolvedOptions fit on one line. */
    .more ul {
        margin: 4px 0 0;
        padding: 0;
        list-style: none;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
        overflow-wrap: normal;
    }

    .apis li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 1px 0;
    }

    /* Call count per API. */
    .calls {
        flex-shrink: 0;
        min-width: 22px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--border);
        color: var(--text);
        font-family: var(--font);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
        line-height: 16px;
        text-align: center;
    }

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
