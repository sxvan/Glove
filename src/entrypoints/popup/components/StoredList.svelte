<script lang="ts">
    // What a script stored in the browser, one row per cookie or item: its name, marked when it is a
    // possible or likely identifier (see findIdentifier), where it is and how long it stays, on the
    // page's own screen the script that wrote it, why an identifier is likely, then the value it
    // holds, so an identifier stands out by its look.
    import type { StoredItem } from '@/types/snapshot';
    import { listWords, plural } from '../format';
    import type { StoredDetail } from '../model';
    import MiddleTruncate from './MiddleTruncate.svelte';
    import { STORAGE_WORDS } from '../statements';

    let { items }: { items: StoredDetail[] } = $props();

    const DAY = 24 * 60 * 60 * 1000;

    /** How long a cookie stays after it was written: "for 1 year", "for 30 days", "until the browser closes". */
    function kept(item: StoredItem): string {
        if (item.kind !== 'cookie') return item.kind === 'sessionStorage' ? 'until the tab closes' : 'until cleared';
        if (item.expires === null) return 'until the browser closes';
        const ms = item.expires - item.last;
        // A year from a moment before the write was noted is still a year.
        if (ms >= 360 * DAY) return `for ${plural(Math.round(ms / (365 * DAY)), 'year')}`;
        if (ms >= DAY) return `for ${plural(Math.round(ms / DAY), 'day')}`;
        if (ms >= 60 * 60 * 1000) return `for ${plural(Math.round(ms / (60 * 60 * 1000)), 'hour')}`;
        return `for ${plural(Math.max(1, Math.round(ms / 60000)), 'minute')}`;
    }

    const IDENTIFIER_TITLES = {
        possible: 'Kept long enough to identify across visits, with a part that looks like an identifier (see the scoring settings)',
        likely: 'A possible identifier that is also stored in another place, to restore it from there, or stored right after a burst that is possible fingerprinting on its own',
    };

    /** Why an identifier is likely: "Also in local storage", "Stored right after reading". */
    function reasons(item: StoredDetail): string {
        const places = item.copies.map((copy) => {
            const words = copy.kind === 'cookie' ? 'a cookie' : STORAGE_WORDS[copy.kind];
            return copy.name === item.name ? words : `${words} as ${copy.name || '(no name)'}`;
        });
        return [places.length > 0 ? `Also in ${listWords([...new Set(places)])}` : '', item.afterReading ? 'Stored right after reading' : ''].filter(Boolean).join(' · ');
    }

    function where(item: StoredItem): string {
        const words = STORAGE_WORDS[item.kind];
        return words.charAt(0).toUpperCase() + words.slice(1);
    }
</script>

<ul class="stored">
    <!-- By position: on the page's own screen, two scripts can store under the same name. -->
    {#each items as item, i (i)}
        <li>
            <span class="title">
                <span class="name">{item.name || '(no name)'}</span>
                {#if item.identifier}<span class="tag tone-{item.identifier}" title={IDENTIFIER_TITLES[item.identifier]}>{item.identifier === 'likely' ? 'Likely' : 'Possible'} identifier</span>{/if}
            </span>
            <span class="meta">{where(item)}, kept {kept(item)}{item.writes > 1 ? ` · written ${plural(item.writes, 'time')}` : ''}</span>
            <!-- One line per script, named like its card: its path, the file name kept, then who serves it. -->
            {#each item.by ?? [] as script (script.url)}
                <span class="meta by" title={script.url}><span>By</span><MiddleTruncate text={script.name} path={script.path} plain /><span class="origin">· {script.origin}</span></span>
            {/each}
            {#if item.identifier && reasons(item)}<span class="meta">{reasons(item)}</span>{/if}
            {#if item.value !== null}<span class="value" title={item.value}>{item.value || '(empty)'}</span>{/if}
        </li>
    {/each}
</ul>

<style>
    .stored {
        display: grid;
        gap: 14px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    li {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    .title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    /* Marks an identifier, in the color of the same likelihood of a script (see theme). */
    .tag {
        flex: none;
        padding: 0 6px;
        border: 1px solid var(--color);
        border-radius: 4px;
        color: var(--color);
        font-size: 11px;
        font-weight: 600;
        line-height: 16px;
    }

    .name {
        overflow: hidden;
        font-family: var(--mono);
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .meta {
        color: var(--muted);
        font-size: 12px;
    }

    /* "By" and the host keep their width; the script's path is shortened in the middle. */
    .by {
        display: flex;
        gap: 4px;
        min-width: 0;
        white-space: nowrap;
    }

    .by > :global(.truncate) {
        flex: 0 1 auto;
    }

    .origin {
        flex: none;
    }

    /* The value, on one line: its look (long and random, or a word) is what tells. */
    .value {
        overflow: hidden;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
