<script lang="ts">
    // A card for a script, or for the page as a whole (all its scripts together): its name and who
    // serves it beside the score, then what it read, signs of fingerprinting, and where it sent data.
    import { viewerUrl } from '@/lib/script-viewer';
    import { bytes, listWords, plural } from '../format';
    import type { ScriptDetail } from '../model';
    import type { TextPart } from '../text-parts';
    import LikelihoodLabel from './LikelihoodLabel.svelte';
    import MiddleTruncate from './MiddleTruncate.svelte';
    import ScoreRing from './ScoreRing.svelte';
    import ScoreTree from './ScoreTree.svelte';
    import SignalLine from './SignalLine.svelte';

    let { script }: { script: ScriptDetail } = $props();

    // Whether the signals the score was combined from show.
    let breakdown = $state(false);

    /** A statement about a script, shown as an info line: the card's rating is its only judgment, in color. */
    interface Statement {
        key: string;
        /** The heading, with its values marked to be emphasized: counts with what they count ("27 fingerprinting APIs"), sizes, sites. */
        text: TextPart[];
        /** Below the text without an icon, e.g. the kinds of detail under "Read 40 fingerprinting APIs". */
        detail?: string;
    }

    /**
     * What the card says about a script, as a list of statements: what it read (always there, and
     * always first), how (signs of fingerprinting), who is behind it if that is hidden, and where
     * it sent data right after.
     */
    function statements(): Statement[] {
        // The most identifying kinds first, so those named are the ones that matter most.
        const kinds = listWords(
            script.learned.map(({ kind }) => kind.toLowerCase()),
            SHOWN_ITEMS
        );
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
        // A CNAME-cloaked script: served from an address of the site that is an alias for another company.
        if (script.via) {
            list.push({
                key: 'cloaked',
                text: ['Served by ', { value: script.origin }, ' through ', { value: script.via }],
                detail: script.aliasOf ? `${script.via} is an alias for ${script.aliasOf}` : '',
            });
        }
        const sent = sentStatement();
        if (sent) list.push(sent);
        return list;
    }

    // Items named in a list under a statement (kinds of detail, sites); the rest as "and N more".
    const SHOWN_ITEMS = 6;

    /**
     * All the requests with data in one line, the sites below it, the most data first: "Sent 6 KB to
     * 3 sites right after reading" over "To digitec.ch, doubleclick.net, google.com", like "About …"
     * under what it read; past SHOWN_ITEMS, "and N more". A single site is named in the line itself,
     * with the alias it went through, if any. Only requests from a burst until shortly after it count
     * (see fp-analysis); the requests themselves are for a screen of their own.
     */
    function sentStatement(): Statement | null {
        const bySite = new Map<string, { total: number; vias: Set<string | null> }>();
        for (const { site, via, bytes } of script.sent) {
            const entry = bySite.get(site) ?? { total: 0, vias: new Set() };
            entry.total += bytes;
            entry.vias.add(via);
            bySite.set(site, entry);
        }
        const sites = [...bySite.entries()].map(([site, entry]) => ({ site, ...entry })).sort((a, b) => b.total - a.total);
        if (sites.length === 0) return null;

        const total = bytes(sites.reduce((sum, site) => sum + site.total, 0));
        if (sites.length === 1) {
            const { site, vias } = sites[0]!;
            // Through an alias only when all its requests went through the same one.
            const via = vias.size === 1 ? [...vias][0] : null;
            const text: TextPart[] = ['Sent ', { value: total }, ' to ', { value: site }];
            if (via) text.push(' through ', { value: via });
            text.push(' right after reading');
            return { key: 'sent', text };
        }
        return {
            key: 'sent',
            text: ['Sent ', { value: total }, ' to ', { value: plural(sites.length, 'site') }, ' right after reading'],
            detail: `To ${listWords(
                sites.map(({ site }) => site),
                SHOWN_ITEMS
            )}`,
        };
    }
</script>

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
            <!-- Who really serves it; how a CNAME-cloaked script hides is an info line, and the tooltip. -->
            <span class="origin" title={script.originTitle}>{script.origin}</span>
        </div>
        <!-- Opens what the score was combined from (the chevron after the likelihood says it can). -->
        <button
            type="button"
            class="rating"
            aria-expanded={breakdown}
            disabled={script.tree.length === 0}
            title={breakdown ? 'Hide how the score came about' : 'Show how the score came about'}
            onclick={() => (breakdown = !breakdown)}
        >
            <ScoreRing value={script.score} color="var(--{script.likelihood})" scale={100} title="Score {Math.round(script.score * 100)}" />
            <span class="likelihood">
                <LikelihoodLabel likelihood={script.likelihood} />
                {#if script.tree.length > 0}<span class="chevron" class:open={breakdown} aria-hidden="true"></span>{/if}
            </span>
        </button>
    </div>

    {#if breakdown}
        <ScoreTree nodes={script.tree} />
    {/if}

    <ul class="statements">
        {#each statements() as statement (statement.key)}
            <!-- Detail screens per statement are to come; the column is there already. -->
            <SignalLine text={statement.text} tone="info" detail={statement.detail} lead details />
        {/each}
    </ul>
</article>

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
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .rating:disabled {
        cursor: default;
    }

    .likelihood {
        display: inline-flex;
        align-items: center;
        gap: 5px;
    }

    /* Points down while the breakdown is closed, up while it is open; muted, so the likelihood
       keeps its color to itself. */
    .chevron {
        width: 4px;
        height: 4px;
        margin-top: -3px;
        border-right: 1.5px solid var(--muted);
        border-bottom: 1.5px solid var(--muted);
        transform: rotate(45deg);
    }

    .chevron.open {
        margin-top: 3px;
        transform: rotate(-135deg);
    }

    .rating:hover .chevron {
        border-color: var(--text);
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

    /* What the card says about the script: facts and signs of fingerprinting, one per line. */
    .statements {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
</style>
