<script lang="ts">
    // The fingerprinting APIs a script read, one compact row each: what it reveals, its name, and a
    // bar of what it counts toward the score (its rare bits, see ApiDetail.counted). A row opens into the details: how identifying and how common
    // it is, how often, from how many places and when it was called. Everyday reads, which count next
    // to nothing, are folded into one row at the end. Sorted, through a menu, by what they count, by
    // their bits or rarity alone, by kind (alphabetically), by name, how often they were called, or
    // when first.
    import { elapsed, plural, roughCount } from '../format';
    import type { ApiDetail } from '../model';

    let { apis }: { apis: ApiDetail[] } = $props();

    // The orders, chosen in a menu, each with what it sorts by. Each starts the way it is most
    // useful: counting most, revealing most, rarest and most called first; kinds and names from A to
    // Z; by when the APIs were first called (`descending`: largest first). The button next to the
    // menu turns the direction around.
    type Order = 'counts' | 'bits' | 'rarity' | 'kind' | 'name' | 'calls' | 'first';
    const ORDERS: { order: Order; label: string; note: string; descending: boolean }[] = [
        { order: 'counts', label: 'Rare bits', note: 'What it adds to the score: its bits times its rarity weight', descending: true },
        { order: 'bits', label: 'Bits', note: 'How much it tells browsers apart on its own', descending: true },
        { order: 'rarity', label: 'Rarity', note: 'How few page loads read it', descending: true },
        { order: 'kind', label: 'Kind', note: 'Kind of detail, from A to Z', descending: false },
        { order: 'name', label: 'API', note: 'Name, from A to Z', descending: false },
        { order: 'calls', label: 'Calls', note: 'How often it was called', descending: true },
        { order: 'first', label: 'Call time', note: 'When it was first called', descending: false },
    ];
    // By what they count by default: what makes the script suspicious comes first, as in the score.
    let order = $state<Order>('counts');
    // Whether the order is turned around from where it starts.
    let reversed = $state(false);
    let menuOpen = $state(false);

    function choose(next: Order) {
        order = next;
        reversed = false;
        menuOpen = false;
    }

    const current = $derived(ORDERS.find((o) => o.order === order)!);
    // Whether the first rows hold the largest values, for the direction button.
    const descending = $derived(current.descending !== reversed);

    // The menu closes on Escape and on a click outside it.
    let menu = $state<HTMLElement>();
    function closeOnOutside(event: PointerEvent) {
        if (menuOpen && menu && !menu.contains(event.target as Node)) menuOpen = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
        if (menuOpen && event.key === 'Escape') menuOpen = false;
    }

    // Rare bits below which a read is an everyday one, folded into a row of its own: the window's
    // inner size counts 0.07, the outer one 0.62, a hidden canvas 5.1.
    const EVERYDAY_MAX_RARE_BITS = 0.2;
    // Rows shown before "Show N more".
    const SHOWN = 15;
    let showAll = $state(false);
    let showEveryday = $state(false);
    // The rows opened into their details, by API id.
    let open = $state<Record<string, boolean>>({});

    /** The APIs in the chosen order and direction. */
    function ordered(list: ApiDetail[]): ApiDetail[] {
        // The APIs come sorted by what they count (see apiDetails).
        const inOrder =
            order === 'counts'
                ? list
                : order === 'bits'
                  ? [...list].sort((a, b) => b.bits - a.bits || a.id.localeCompare(b.id))
                  : order === 'rarity'
                    ? [...list].sort((a, b) => b.rarity - a.rarity || a.id.localeCompare(b.id))
                    : order === 'kind'
                  ? byKind(list).flatMap((group) => group.rows)
                  : order === 'name'
                    ? [...list].sort((a, b) => a.id.localeCompare(b.id))
                    : order === 'calls'
                      ? [...list].sort((a, b) => b.calls - a.calls || a.id.localeCompare(b.id))
                      : [...list].sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity) || a.id.localeCompare(b.id));
        // Turned around by kind, the kinds go from Z to A, each still with what counts most first.
        return !reversed ? inOrder : order === 'kind' ? byKind(list, true).flatMap((group) => group.rows) : [...inOrder].reverse();
    }

    const counting = $derived(ordered(apis.filter((api) => api.counted.rareBits >= EVERYDAY_MAX_RARE_BITS)));
    const everyday = $derived(ordered(apis.filter((api) => api.counted.rareBits < EVERYDAY_MAX_RARE_BITS)));
    const shown = $derived(showAll ? counting : counting.slice(0, SHOWN));
    const everydayBits = $derived(everyday.reduce((sum, api) => sum + api.counted.rareBits, 0));
    // What the everyday reads are about, in a few words: the kinds of the most of them first.
    const everydayKinds = $derived(
        [...Map.groupBy(everyday, (api) => api.kind)]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([kind]) => kind.toLowerCase())
    );

    /** APIs by kind, the kinds from A to Z (or Z to A), each with what counts most first. */
    function byKind(list: ApiDetail[], zToA = false): { kind: string; rows: ApiDetail[] }[] {
        const kinds = new Map<string, ApiDetail[]>();
        for (const api of list) kinds.set(api.kind, [...(kinds.get(api.kind) ?? []), api]);
        const groups = [...kinds].map(([kind, rows]) => ({ kind, rows })).sort((a, b) => a.kind.localeCompare(b.kind));
        return zToA ? groups.reverse() : groups;
    }

    // Headed by kind only in that order; the rows shown regrouped in the same direction.
    const groups = $derived(order === 'kind' ? byKind(shown, reversed) : [{ kind: '', rows: shown }]);

    // The bar's scale, the same for every script: full at this many rare bits, about the most one API
    // counts (a hidden canvas read at full rarity: 7.8).
    const BAR_FULL_RARE_BITS = 8;
    const barWidth = (rareBits: number) => `${Math.min(1, Math.max(0, rareBits / BAR_FULL_RARE_BITS)) * 100}%`;

    /** An amount of rare bits: one decimal, two below 1 ("0.07"), without trailing zeros. */
    const amount = (x: number) => String(+x.toFixed(x < 1 ? 2 : 1));

    /**
     * The value a row shows on the right: the one sorted by, so the column reads as sorted, as a
     * number under the heading naming it ("7.8", "0.96", "6", "1.2 s"); by kind or name, which the
     * row shows itself, its rare bits.
     */
    function sortedValue(api: ApiDetail): { text: string; title: string } {
        switch (order) {
            case 'bits':
                return { text: String(+api.bits.toFixed(1)), title: 'Bits: how much it tells browsers apart on its own' };
            case 'rarity':
                return { text: String(+api.rarity.toFixed(2)), title: 'Rarity: 1 minus the share of page loads that read it' };
            case 'calls':
                return { text: String(api.calls), title: 'Calls: how often it was called' };
            case 'first':
                return { text: api.first === null ? '–' : elapsed(api.first), title: 'Call time: when it was first called, since the page started' };
            default:
                return {
                    text: api.counted.countedWith ? '–' : amount(api.counted.rareBits),
                    title: 'Rare bits: its bits times its rarity weight, what it counts toward the score',
                };
        }
    }

    /**
     * The heading over the right column: what it shows when sorted by something else than rare bits;
     * empty when it shows rare bits too, as the heading over the bar then covers both.
     */
    const valueHeading = $derived(({ bits: 'Bits', rarity: 'Rarity', calls: 'Calls', first: 'Call time' } as Partial<Record<Order, string>>)[order] ?? '');

    /** When an API was called, since the page started: "1.5 s", or "1.2–11.2 s" over a while. */
    function when(api: ApiDetail): string {
        if (api.first === null) return '';
        if (api.last === null || api.last - api.first < 100) return elapsed(api.first);
        const [first, last] = [elapsed(api.first), elapsed(api.last)];
        // One unit for both when they share it: "1.2–11.2 s".
        return first.endsWith(' s') && last.endsWith(' s') && !first.includes('min') && !last.includes('min') ? `${first.slice(0, -2)}–${last}` : `${first}–${last}`;
    }

    /**
     * An API's details, one fact a line, each named as in the sort menu and the headings: what it
     * counts toward the score and the two factors it is made of, then how often and when it was called.
     */
    function facts(api: ApiDetail): { term: string; value: string; note: string }[] {
        const bits = Math.round(api.bits * 10) / 10;
        const share = (1 - api.rarity) * 100;
        const counted = api.counted;
        // The bits it counted: all of them, what it adds beside an overlapping API, or none.
        const bitsNote = counted.countedWith
            ? `the same information as ${counted.countedWith}, which counts instead`
            : counted.overlapsWith
              ? `${bits} on its own, beside ${counted.overlapsWith}`
              : api.bits < 0.95
                ? 'hardly tells browsers apart'
                : `one browser in ${roughCount(2 ** bits)}`;
        const time = when(api);
        return [
            { term: 'Rare bits', value: counted.countedWith ? '–' : amount(counted.rareBits), note: `${amount(counted.bits)} × ${amount(counted.weight)}` },
            { term: 'Bits', value: counted.overlapsWith || counted.countedWith ? amount(counted.bits) : String(bits), note: bitsNote },
            {
                term: 'Rarity',
                value: String(+api.rarity.toFixed(2)),
                note: `${share < 1 ? 'under 1%' : `${Math.round(share)}%`} of page loads, so ${Math.round(counted.weight * 100)}% of its bits count`,
            },
            { term: 'Calls', value: String(api.calls), note: api.places > 1 ? `from ${api.places} places` : '' },
            ...(time ? [{ term: 'Call time', value: time, note: '' }] : []),
        ];
    }

    const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
</script>

{#snippet apiRow(api: ApiDetail)}
    <li class="row squircle" class:open={open[api.id]}>
        <button type="button" class="head" aria-expanded={!!open[api.id]} onclick={() => (open[api.id] = !open[api.id])}>
            <span class="what">
                <span class="reveals">{capitalize(api.reveals || api.id)}</span>
                <span class="name" title={api.id}>{api.id}</span>
            </span>
            <!-- Filled as far as its rare bits, what it counts toward the score. -->
            <span class="bar" aria-hidden="true">
                <span class="track"></span>
                <span class="fill" style:width={barWidth(api.counted.rareBits)}></span>
            </span>
            <!-- The value sorted by; by name or kind, which the row shows itself, what it counts. -->
            <span class="amount" title={sortedValue(api).title}>{sortedValue(api).text}</span>
            <span class="chevron" aria-hidden="true"></span>
        </button>
        {#if open[api.id]}
            <dl class="facts">
                {#each facts(api) as fact (fact.term)}
                    <dt>{fact.term}</dt>
                    <dd class="value">{fact.value}</dd>
                    <dd class="note">{fact.note}</dd>
                {/each}
            </dl>
        {/if}
    </li>
{/snippet}

<svelte:window onpointerdown={closeOnOutside} onkeydown={closeOnEscape} />

<div class="api-table">
    <!-- "Sort by Counts ▾" with the direction next to it; the menu lists the orders with what each sorts by. -->
    <div class="sorting" bind:this={menu}>
        <span class="sort-label" id="sort-label">Sort by</span>
        <button type="button" class="menu-button" aria-haspopup="listbox" aria-expanded={menuOpen} aria-labelledby="sort-label" onclick={() => (menuOpen = !menuOpen)}>
            <!-- All labels in one cell, only the current one visible: as wide as the longest, so the carets next to it stay put. -->
            <span class="labels">
                {#each ORDERS as option (option.order)}
                    <span class:shown={option.order === order} aria-hidden={option.order !== order}>{option.label}</span>
                {/each}
            </span>
            <span class="caret" aria-hidden="true"></span>
        </button>
        <button
            type="button"
            class="direction"
            title={descending ? 'Largest first: click for smallest first' : 'Smallest first: click for largest first'}
            aria-label={descending ? 'Largest first' : 'Smallest first'}
            onclick={() => (reversed = !reversed)}
        >
            <!-- Both halves, the one of the direction shown. -->
            <span class="carets" aria-hidden="true">
                <span class="up" class:on={!descending}></span>
                <span class="down" class:on={descending}></span>
            </span>
        </button>
        {#if menuOpen}
            <ul class="menu squircle" role="listbox" aria-labelledby="sort-label">
                {#each ORDERS as option (option.order)}
                    <li role="option" aria-selected={option.order === order}>
                        <button type="button" class="option" class:chosen={option.order === order} onclick={() => choose(option.order)}>
                            <span class="option-label">{option.label}</span>
                            <span class="option-note">{option.note}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    <!-- Headings over the columns, like a table's: the API, its rare bits (the bar), the value sorted by. -->
    <div class="headings" aria-hidden="true">
        <span>API</span>
        <span class="bar-heading" class:wide={!valueHeading}>Rare bits</span>
        {#if valueHeading}<span class="value-heading">{valueHeading}</span>{/if}
    </div>

    {#each groups as group (group.kind)}
        {#if group.kind}<h4 class="kind">{group.kind}</h4>{/if}
        <ul class="rows">
            {#each group.rows as api (api.id)}
                {@render apiRow(api)}
            {/each}
        </ul>
    {/each}

    {#if counting.length > SHOWN}
        <button type="button" class="more" class:open={showAll} onclick={() => (showAll = !showAll)}>
            {showAll ? 'Show less' : `Show ${counting.length - SHOWN} more`}
        </button>
    {/if}

    <!-- The everyday reads in one row; opened, each of them like the others. -->
    {#if everyday.length > 0}
        <button type="button" class="everyday squircle" aria-expanded={showEveryday} onclick={() => (showEveryday = !showEveryday)}>
            <span class="what">
                <span class="reveals">{plural(everyday.length, 'everyday read')}</span>
                <span class="kinds">About {everydayKinds.slice(0, 4).join(', ')}{everydayKinds.length > 4 ? ` and ${everydayKinds.length - 4} more` : ''}</span>
            </span>
            <span class="amount" title="The rare bits they count together">{amount(everydayBits)}</span>
            <span class="chevron" class:down={showEveryday} aria-hidden="true"></span>
        </button>
        {#if showEveryday}
            <ul class="rows">
                {#each everyday as api (api.id)}
                    {@render apiRow(api)}
                {/each}
            </ul>
        {/if}
    {/if}
</div>

<style>
    /* The API | its bar | the value sorted by | a chevron: the headings, the rows and the everyday
       reads' row take these columns (subgrid), so they line up. The bar has a part of the width,
       the value and the chevron as much as they need; everything else spans them all. */
    .api-table {
        display: grid;
        grid-template-columns: minmax(0, 4fr) minmax(0, 1fr) auto auto;
        gap: 12px 10px;
    }

    .api-table > *,
    .rows > *,
    .row > * {
        grid-column: 1 / -1;
    }

    .headings,
    .rows,
    .row,
    .head,
    .everyday {
        display: grid;
        grid-template-columns: subgrid;
    }

    /* "Sort by" and the menu button on the left, the direction on the right. */
    .sorting {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
    }

    .sort-label {
        color: var(--muted);
    }

    .menu-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border: 0;
        border-radius: 7px;
        background: var(--fill);
        color: var(--text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }

    .menu-button:hover {
        background: color-mix(in srgb, var(--fill) 70%, var(--muted));
    }

    .labels {
        display: inline-grid;
    }

    .labels > span {
        grid-area: 1 / 1;
        visibility: hidden;
    }

    .labels > .shown {
        visibility: visible;
    }

    /* The direction: the stacked carets of a sortable column, next to the order. */
    .direction {
        display: inline-flex;
        align-items: center;
        padding: 4px;
        border: 0;
        background: none;
        color: var(--muted);
        cursor: pointer;
    }

    .direction:hover {
        color: var(--text);
    }

    /* A small downward triangle, the menu's sign. */
    .caret {
        width: 0;
        height: 0;
        border-top: 4px solid currentColor;
        border-right: 3.5px solid transparent;
        border-left: 3.5px solid transparent;
        opacity: 0.7;
    }

    /* A small up and down triangle stacked, as in a table's sortable column: the direction's one
       full, the other faint. */
    .carets {
        display: inline-grid;
        gap: 2px;
    }

    .up,
    .down {
        width: 0;
        height: 0;
        border-right: 3.5px solid transparent;
        border-left: 3.5px solid transparent;
        opacity: 0.35;
    }

    .up {
        border-bottom: 4px solid currentColor;
    }

    .down {
        border-top: 4px solid currentColor;
    }

    .up.on,
    .down.on {
        opacity: 1;
    }

    /* The menu: a raised surface under the button, over the rows. */
    .menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 40px;
        z-index: 2;
        display: grid;
        min-width: 230px;
        margin: 0;
        padding: 4px;
        border-radius: 10px;
        background: var(--surface);
        box-shadow: 0 6px 24px var(--shadow);
        list-style: none;
    }

    .option {
        display: grid;
        gap: 1px;
        width: 100%;
        padding: 6px 8px;
        border: 0;
        border-radius: 7px;
        background: none;
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .option:hover {
        background: var(--fill);
    }

    .option.chosen .option-label {
        font-weight: 600;
    }

    .option-label {
        font-size: 13px;
    }

    .option-note {
        color: var(--muted);
        font-size: 12px;
    }

    /* A kind's heading: small and muted, set apart by the space above it. */
    .kind {
        margin: 12px 0 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
    }

    /* Out into the card's padding by the rows' own, so their text stays in line with the headings. */
    .rows {
        row-gap: 2px;
        margin: 0 -10px;
        padding: 0;
        list-style: none;
    }

    .row {
        border-radius: 10px;
    }

    /* Every second row on a slightly lighter surface: the rows are told apart without lines. */
    .row:nth-child(even) {
        background: var(--fill);
    }

    /* The headings, on the rows' grid and in line with their text; small and muted. */
    .headings {
        margin: 0 -10px -6px;
        padding: 0 10px;
        color: var(--muted);
        font-size: 12px;
    }

    /* Over the bar; without a value heading, over the bar and the number. */
    .bar-heading.wide {
        grid-column: 2 / 4;
    }

    /* On one line, ending where the numbers below end. */
    .value-heading {
        justify-self: end;
        white-space: nowrap;
    }

    /* What it is, its bar, what it counts and a chevron to open it: one line of text over its name. */
    .head,
    .everyday {
        align-items: center;
        padding: 8px 10px;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .what {
        display: grid;
        gap: 2px;
        min-width: 0;
    }

    .reveals {
        font-size: 14px;
        font-weight: 500;
    }

    /* The API's name: one line, cut at the end (the tooltip has it). Toned like a card's info
       lines: clearer than the facts around it, below what it reveals. */
    .name,
    .kinds {
        overflow: hidden;
        color: color-mix(in srgb, var(--text) 70%, var(--muted));
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .name {
        font-family: var(--mono);
    }

    .kinds {
        color: var(--muted);
    }

    /* The bar: a faint track the same length in every row, filled as far as its rare bits, in the
       color of the score tree's "Rare identifying APIs". */
    .bar {
        position: relative;
        height: 6px;
    }

    .track,
    .fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: 3px;
    }

    .track {
        width: 100%;
        background: color-mix(in srgb, var(--muted) 25%, transparent);
    }

    .fill {
        background: #6366f1;
    }

    .amount {
        color: var(--muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    /* A chevron pointing right while closed, down while open, like the score tree's. */
    .chevron {
        width: 5px;
        height: 5px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        color: var(--muted);
        transform: rotate(-45deg);
    }

    .row.open .chevron,
    .chevron.down {
        transform: rotate(45deg);
    }

    /* Its details under it, in line with its text: the terms, their values and the notes in
       columns, so they read down as well as across. */
    .facts {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr);
        gap: 3px 12px;
        margin: -2px 0 0;
        padding: 0 10px 10px;
        font-size: 12px;
        line-height: 1.4;
    }

    .facts dt {
        color: var(--muted);
    }

    .facts dd {
        margin: 0;
    }

    .facts .value {
        color: color-mix(in srgb, var(--text) 85%, var(--muted));
        font-variant-numeric: tabular-nums;
        font-weight: 500;
    }

    .facts .note {
        color: var(--muted);
    }

    /* The everyday reads' row: like the others, on the fill, quieter. */
    .everyday {
        margin: 0 -10px;
        border-radius: 10px;
        background: var(--fill);
    }

    .everyday .reveals {
        color: color-mix(in srgb, var(--text) 70%, var(--muted));
    }

    /* Its bar's column stays empty: the reads count next to nothing. */
    .everyday .amount {
        grid-column: 3;
    }

    /* Show more / show less, like the score tree's. */
    .more {
        justify-self: start;
        padding: 2px 0;
        border: 0;
        background: none;
        color: color-mix(in srgb, var(--info) 45%, var(--muted));
        font: inherit;
        font-size: 12px;
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
</style>
