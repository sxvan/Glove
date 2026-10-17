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
        /** For "Sent …": the requests, listed below it. */
        requests?: SentRequest[];
    }

    // Lines the requests of a site take at most: all of them if they fit, otherwise one fewer and
    // "Show N more" on the last line. And which sites show all (by script and site).
    const REQUEST_LINES = 3;
    let allRequests = $state<Record<string, boolean>>({});

    /** How many of a site's requests to show while collapsed. */
    function shownRequests(count: number): number {
        return count <= REQUEST_LINES ? count : REQUEST_LINES - 1;
    }

    /**
     * What the card says about a script, as a list of statements. First what is always there (what
     * it read, and about what), then signs of fingerprinting, then where it sent data right after.
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
        for (const sent of sentBySite(script)) list.push({ key: `sent ${sent.key}`, text: sent.text, requests: sent.requests });
        return list;
    }

    /** The requests with data, combined per site: "Sent 4.6 KB to walgreens.com right after reading". */
    function sentBySite(script: ScriptDetail): { key: string; text: TextPart[]; requests: SentRequest[] }[] {
        // Requests that went through a CNAME alias stay apart from direct ones to the same site.
        const bySite = new Map<string, SentRequest[]>();
        for (const request of script.sent) {
            const key = `${request.site} ${request.via ?? ''}`;
            bySite.set(key, [...(bySite.get(key) ?? []), request]);
        }
        return [...bySite.entries()].map(([key, requests]) => {
            const { site, via } = requests[0]!;
            const total = requests.reduce((sum, r) => sum + r.bytes, 0);
            const text: TextPart[] = ['Sent ', { value: bytes(total) }, ' to ', { value: site }];
            if (via) text.push(' through ', { value: via });
            // Only requests from a burst until shortly after it are listed (see fp-analysis).
            text.push(' right after reading');
            return { key, text, requests };
        });
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
                {#if statement.requests}
                    {@const key = `${script.key} ${statement.key}`}
                    {@const showAll = allRequests[key] ?? false}
                    {@const shown = shownRequests(statement.requests.length)}
                    <SignalLine text={statement.text} tone="info" lead>
                        <!-- Method | path | how much data. -->
                        <span class="requests">
                            {#each showAll ? statement.requests : statement.requests.slice(0, shown) as request, i (i)}
                                <span class="request">
                                    <span class="method">{request.method}</span>
                                    <span class="path" title={request.path}><MiddleTruncate text={request.path} path /></span>
                                    <span class="size">{bytes(request.bytes)}</span>
                                </span>
                            {/each}
                            {#if statement.requests.length > shown}
                                <button type="button" class="more" onclick={() => (allRequests[key] = !showAll)}>
                                    {showAll ? 'Show less' : `Show ${statement.requests.length - shown} more`}
                                </button>
                            {/if}
                        </span>
                    </SignalLine>
                {:else}
                    <SignalLine text={statement.text} tone="info" detail={statement.detail} lead />
                {/if}
            {/each}
        </ul>
    </article>
{/each}

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

    .more {
        grid-column: 1 / -1;
        justify-self: start;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        font: inherit;
        cursor: pointer;
    }

    .more:hover {
        color: var(--text);
    }

    .empty {
        margin: 0;
        color: var(--muted);
    }
</style>
