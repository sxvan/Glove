<script lang="ts">
    import { viewerUrl } from '@/lib/script-viewer';
    import LikelihoodLabel from '../components/LikelihoodLabel.svelte';
    import MiddleTruncate from '../components/MiddleTruncate.svelte';
    import ScoreRing from '../components/ScoreRing.svelte';
    import SignalLine from '../components/SignalLine.svelte';
    import { bytes, plural } from '../format';
    import type { PageScore, ScriptDetail, SentRequest } from '../model';
    import type { TextPart } from '../text-parts';

    let { page, scripts }: { page: PageScore; scripts: ScriptDetail[] } = $props();

    /** A statement about a script, shown as an info line: the card's rating is its only judgment, in color. */
    interface Statement {
        key: string;
        /** The heading, with its values marked to be emphasized: counts with what they count ("27 fingerprinting APIs"), sizes, sites. */
        text: TextPart[];
        /** Below the text without an icon, e.g. the kinds of detail under "Read 40 fingerprinting APIs". */
        detail?: string;
    }

    // Lines a list takes at most while collapsed (the sites a script sent data to, and the requests
    // to each): all of it if it fits, otherwise one fewer and the rest on the last line, as "Show N
    // more" for requests and as one line summing up the other sites.
    const COLLAPSED_LINES = 3;
    // Which scripts show all their sites (by script), and which sites all their requests (by script and site).
    let allSites = $state<Record<string, boolean>>({});
    let allRequests = $state<Record<string, boolean>>({});

    /** How many of `count` items to show while collapsed. */
    function shownWhileCollapsed(count: number): number {
        return count <= COLLAPSED_LINES ? count : COLLAPSED_LINES - 1;
    }

    /** The other sites, as one line: "Sent 64 KB to 6 more sites right after reading". */
    function sentSummary(sites: SentSite[]): TextPart[] {
        const total = sites.reduce((sum, site) => sum + site.total, 0);
        return ['Sent ', { value: bytes(total) }, ' to ', { value: plural(sites.length, 'more site') }, ' right after reading'];
    }

    /**
     * What the card says about a script, as a list of statements: what is always there (what it
     * read, and about what), then signs of fingerprinting. Where it sent data is listed after them
     * (see sentBySite).
     */
    function statements(script: ScriptDetail): Statement[] {
        const kinds = script.learned.map(({ kind }) => kind.toLowerCase()).join(', ');
        const list: Statement[] = [
            {
                key: 'read',
                text: ['Read ', { value: plural(script.apis.length, 'fingerprinting API') }, ' in ', { value: plural(script.calls, 'call') }],
                detail: kinds ? `About ${kinds}` : '',
            },
        ];
        for (const signal of script.signals) {
            list.push({ key: signal.id, text: [{ value: plural(signal.count, 'API') }, ` ${signal.rest}`] });
        }
        return list;
    }

    /**
     * The requests with data, combined per site, the most data first: "Sent 4.6 KB to walgreens.com
     * right after reading".
     */
    function sentBySite(script: ScriptDetail): SentSite[] {
        // Requests that went through a CNAME alias stay apart from direct ones to the same site.
        const bySite = new Map<string, SentRequest[]>();
        for (const request of script.sent) {
            const key = `${request.site} ${request.via ?? ''}`;
            bySite.set(key, [...(bySite.get(key) ?? []), request]);
        }
        return [...bySite.entries()]
            .map(([key, requests]) => ({ key, requests, total: requests.reduce((sum, r) => sum + r.bytes, 0) }))
            .sort((a, b) => b.total - a.total)
            .map(({ key, requests, total }) => {
                const { site, via } = requests[0]!;
                const text: TextPart[] = ['Sent ', { value: bytes(total) }, ' to ', { value: site }];
                if (via) text.push(' through ', { value: via });
                // Only requests from a burst until shortly after it are listed (see fp-analysis).
                text.push(' right after reading');
                return { key, text, requests, total };
            });
    }

    /** The requests with data to one site, in one line with the requests below it. */
    interface SentSite {
        key: string;
        text: TextPart[];
        requests: SentRequest[];
        total: number;
    }
</script>

{#if scripts.length === 0}
    <p class="empty">No script on this page has read identifying device details so far.</p>
{:else}
    <section class="card sleek">
        <div class="head">
            <div class="who">
                <span class="name">This page</span>
                <span class="origin">All its scripts together</span>
            </div>
            <div class="rating">
                <ScoreRing value={page.score} color="var(--{page.likelihood})" scale={100} title="Page score {Math.round(page.score * 100)}" />
                <LikelihoodLabel likelihood={page.likelihood} />
            </div>
        </div>
    </section>
{/if}

{#each scripts as script (script.key)}
    {@const sites = sentBySite(script)}
    {@const shownSites = shownWhileCollapsed(sites.length)}
    {@const rest = sites.slice(shownSites)}
    {@const showRest = allSites[script.key] ?? false}
    <article class="card sleek">
        <!-- The name over who serves it, beside the score ring over the likelihood. -->
        <div class="head">
            <div class="who">
            {#if script.viewer}
                <a class="name link" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer">
                    <MiddleTruncate text={script.name} path={script.path} />
                </a>
            {:else}
                <span class="name" title={script.url}><MiddleTruncate text={script.name} path={script.path} /></span>
            {/if}
            <!-- Who serves it; for a CNAME-cloaked script also the site's own address it hides behind. -->
            <span class="origin" title={script.originTitle}
                >{script.origin}{#if script.via}{' '}<span class="via">through {script.via}</span>{/if}</span
            >
            </div>
            <div class="rating">
                <ScoreRing value={script.score} color="var(--{script.likelihood})" scale={100} title="Score {Math.round(script.score * 100)}" />
                <LikelihoodLabel likelihood={script.likelihood} />
            </div>
        </div>

        <ul class="statements">
            {#each statements(script) as statement (statement.key)}
                <SignalLine text={statement.text} tone="info" detail={statement.detail} lead />
            {/each}
            <!-- The sites with the most data, then one line for the others, which they follow when shown. -->
            {#each sites.slice(0, shownSites) as sent (sent.key)}
                {@render sentLine(script, sent)}
            {/each}
            {#if rest.length > 0}
                <SignalLine text={sentSummary(rest)} tone="info" lead>
                    <button type="button" class="more" class:open={showRest} onclick={() => (allSites[script.key] = !showRest)}>
                        {showRest ? 'Hide them' : `Show ${rest.length} sites`}
                    </button>
                </SignalLine>
                {#each showRest ? rest : [] as sent (sent.key)}
                    {@render sentLine(script, sent)}
                {/each}
            {/if}
        </ul>
    </article>
{/each}

<!-- "Sent … to a site", with its requests: method | path | how much data. -->
{#snippet sentLine(script: ScriptDetail, sent: SentSite)}
    {@const key = `${script.key} ${sent.key}`}
    {@const showAll = allRequests[key] ?? false}
    {@const shown = shownWhileCollapsed(sent.requests.length)}
    <SignalLine text={sent.text} tone="info" lead>
        <span class="requests">
            {#each showAll ? sent.requests : sent.requests.slice(0, shown) as request, i (i)}
                <span class="request">
                    <span class="method">{request.method}</span>
                    <span class="path" title={request.path}><MiddleTruncate text={request.path} path /></span>
                    <span class="size">{bytes(request.bytes)}</span>
                </span>
            {/each}
            {#if sent.requests.length > shown}
                <button type="button" class="more" class:open={showAll} onclick={() => (allRequests[key] = !showAll)}>
                    {showAll ? 'Show less' : `Show ${sent.requests.length - shown} more`}
                </button>
            {/if}
        </span>
    </SignalLine>
{/snippet}

<style>
    /* The parts of a card are separated by space only. */
    .sleek {
        display: grid;
        gap: 16px;
    }

    /* The name over who serves it, as one tight block, centered beside the score ring with its
       likelihood under it as a caption. The ring's column is narrow, so the name gets the width. */
    .head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
    }

    .who {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    .rating {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    /* One line, shortened in the middle when too long (see MiddleTruncate); the tooltip has the
       full URL. */
    .name {
        display: block;
        min-width: 0;
        font-size: 16px;
        font-weight: 600;
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

    /* The script's identity, next to its file name: in the text color, not toned down. */
    .origin {
        min-width: 0;
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .via {
        color: var(--muted);
    }

    /* What the card says about the script: facts and signs of fingerprinting, one per line. */
    .statements {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* The requests under "Sent …", one per line, in one grid so their paths line up:
       method | path | how much data. Method and size have fixed widths (enough for "DELETE" and
       "999.9 KB"), so the paths line up and get the same room in every "Sent" section. */
    .requests {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 60px;
        align-items: baseline;
        gap: 2px 8px;
    }

    .request {
        display: contents;
    }

    /* Shortened like the script's name, but all in the detail's grey: no emphasis on the last part. */
    .path {
        min-width: 0;
    }

    .size {
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
    }

    /* "Show N more" and the like: an action, not data, so tinted with the accent color and with a
       chevron pointing where the list goes (down to expand, up to collapse), but quiet. */
    .more {
        grid-column: 1 / -1;
        justify-self: start;
        padding: 0;
        border: 0;
        background: none;
        /* Grey with a tint of the accent: set apart from the data without pushing; in full on hover. */
        color: color-mix(in srgb, var(--info) 45%, var(--muted));
        font: inherit;
        cursor: pointer;
    }

    .more::after {
        content: '';
        display: inline-block;
        width: 4px;
        height: 4px;
        margin-left: 6px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        vertical-align: 3px;
        transform: rotate(45deg);
    }

    .more.open::after {
        vertical-align: 0;
        transform: rotate(-135deg);
    }

    .more:hover {
        color: var(--info);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
