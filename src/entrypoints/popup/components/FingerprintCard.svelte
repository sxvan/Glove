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

    // With `onOpen`, the whole card opens a screen about it and nothing in it is clickable on its
    // own: on the overview, the page's card leads to the fingerprinting screen.
    let { script, onOpen }: { script: ScriptDetail; onOpen?: () => void } = $props();

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
            SHOWN_KINDS
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
                detail: script.aliasOf ? `${script.via} alias for ${script.aliasOf}` : '',
            });
        }
        const sent = sentStatement();
        if (sent) list.push(sent);
        const alias = sentThroughAliasStatement();
        if (alias) list.push(alias);
        return list;
    }

    // Items named in a list under a statement, the rest as "and N more": kinds of detail are short
    // words, sites long names, so fewer of them fit in about two lines.
    const SHOWN_KINDS = 6;
    const SHOWN_SITES = 4;

    /**
     * All the requests with data in one line, the sites below it, the most data first: "Sent 6 KB to
     * 3 sites right after reading" over "To digitec.ch, doubleclick.net, google.com", like "About …"
     * under what it read; past SHOWN_SITES, "and N more". A single site is named in the line itself.
     * Aliases the data went through have a line of their own (see sentThroughAliasStatement). Only
     * requests from a burst until shortly after it count (see fp-analysis); the requests themselves
     * are for a screen of their own.
     */
    function sentStatement(): Statement | null {
        const bySite = new Map<string, number>();
        for (const { site, bytes } of script.sent) bySite.set(site, (bySite.get(site) ?? 0) + bytes);
        const sites = [...bySite.entries()].map(([site, total]) => ({ site, total })).sort((a, b) => b.total - a.total);
        if (sites.length === 0) return null;

        const total = bytes(sites.reduce((sum, site) => sum + site.total, 0));
        if (sites.length === 1) {
            return { key: 'sent', text: ['Sent ', { value: total }, ' to ', { value: sites[0]!.site }, ' right after reading'] };
        }
        return {
            key: 'sent',
            text: ['Sent ', { value: total }, ' to ', { value: plural(sites.length, 'site') }, ' right after reading'],
            detail: `To ${listWords(
                sites.map(({ site }) => site),
                SHOWN_SITES
            )}`,
        };
    }

    /**
     * The site's own addresses that data went through to another site, as CNAME aliases, written like
     * the sites under "Sent …": "Sent data through smetrics.walgreens.com alias" over "To omtrdc.net
     * (through smetrics.walgreens.com)", several as "Sent data through 2 aliases" over "To omtrdc.net
     * (through smetrics.walgreens.com and target.walgreens.com)", the rest as "and N more". Cookies
     * sent there count as the site's own (see the sentThroughAlias signal).
     */
    function sentThroughAliasStatement(): Statement | null {
        // The aliases by the site they lead to.
        const bySite = new Map<string, string[]>();
        for (const { site, via } of script.sent) {
            if (!via) continue;
            const vias = bySite.get(site) ?? [];
            if (!vias.includes(via)) vias.push(via);
            bySite.set(site, vias);
        }
        const aliases = [...bySite.values()].flat();
        if (aliases.length === 0) return null;

        const detail = `To ${listWords(
            [...bySite].map(([site, vias]) => `${site} (through ${listWords(vias, SHOWN_SITES)})`),
            SHOWN_SITES
        )}`;
        const text: TextPart[] =
            aliases.length === 1
                ? ['Sent data through ', { value: aliases[0]! }, ' alias']
                : ['Sent data through ', { value: plural(aliases.length, 'alias', 'aliases') }];
        return { key: 'sent-alias', text, detail };
    }
</script>

<svelte:element
    this={onOpen ? 'div' : 'article'}
    class="card sleek"
    class:opens={onOpen}
    role={onOpen ? 'button' : undefined}
    tabindex={onOpen ? 0 : undefined}
    onclick={onOpen}
    onkeydown={(event: KeyboardEvent) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onOpen();
        }
    }}
>
    <!-- The name over who serves it, beside the score ring over the likelihood. -->
    <div class="head">
        <div class="who">
            {#if onOpen}
                <span class="name">{script.name}</span>
            {:else if script.viewer}
                <a class="name link" href={viewerUrl(script.viewer)} target="_blank" rel="noopener noreferrer" title="View {script.url} in the script viewer">
                    <MiddleTruncate text={script.name} path={script.path} />
                </a>
            {:else}
                <span class="name" title={script.url}><MiddleTruncate text={script.name} path={script.path} /></span>
            {/if}
            <!-- Who really serves it; how a CNAME-cloaked script hides is an info line, and the tooltip. -->
            <span class="origin" title={script.originTitle}>{script.origin}</span>
        </div>
        {#if onOpen}
            <div class="rating">
                <ScoreRing value={script.score} color="var(--{script.likelihood})" scale={100} title="Score {Math.round(script.score * 100)}" />
                <LikelihoodLabel likelihood={script.likelihood} />
            </div>
            <!-- Like the overview's other cards: the card leads on to a screen. -->
            <span class="opens-chevron" aria-hidden="true"></span>
        {:else}
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
        {/if}
    </div>

    {#if breakdown}
        <ScoreTree nodes={script.tree} />
    {/if}

    <ul class="statements">
        {#each statements() as statement (statement.key)}
            <!-- Detail screens per statement are to come; the column is there already. -->
            <SignalLine text={statement.text} tone="info" detail={statement.detail} lead details={!onOpen} />
        {/each}
    </ul>
</svelte:element>

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

    /* A card opening a screen as a whole: like the overview's other cards, hovering lightens it. */
    .opens {
        cursor: pointer;
    }

    .opens:hover {
        background: color-mix(in srgb, var(--surface), var(--text) 4%);
    }

    /* The head gets a column for the chevron, after the rating. */
    .opens .head {
        grid-template-columns: minmax(0, 1fr) auto auto;
    }

    /* The same chevron as the overview's other cards. */
    .opens-chevron {
        width: 7px;
        height: 7px;
        margin-left: -4px;
        border-right: 2px solid var(--muted);
        border-bottom: 2px solid var(--muted);
        transform: rotate(-45deg);
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
