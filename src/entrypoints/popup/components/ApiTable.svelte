<script lang="ts">
    // The fingerprinting APIs a script read, in detail: what each reveals, how identifying and how
    // rare it is, how often, from how many places and when it was called. Sorted by how
    // identifying they are, how rare reading them is, by kind (alphabetically), by name, how often
    // they were called, or when first.
    import { elapsed, plural } from '../format';
    import type { ApiDetail } from '../model';

    let { apis }: { apis: ApiDetail[] } = $props();

    // Sortable like a table's columns: clicking the active one again turns its direction around.
    // Each starts the way it is most useful: the most identifying, rarest, most called first; kinds
    // and names from A to Z; by when the APIs were first called. `descending`: largest first.
    type Order = 'identifying' | 'rarest' | 'kind' | 'name' | 'calls' | 'first';
    const ORDERS: { order: Order; label: string; descending: boolean }[] = [
        { order: 'rarest', label: 'Rarity', descending: true },
        { order: 'identifying', label: 'Identification', descending: true },
        { order: 'kind', label: 'Kind', descending: false },
        { order: 'name', label: 'API', descending: false },
        { order: 'calls', label: 'Calls', descending: true },
        { order: 'first', label: 'Call time', descending: false },
    ];
    // Rarest first by default: the unusual APIs are what make a script suspicious (they weigh most
    // in the score), and the everyday ones every site reads go below the fold.
    let order = $state<Order>('rarest');
    // Whether the order is turned around from where it starts.
    let reversed = $state(false);

    function sortBy(next: Order) {
        if (next === order) reversed = !reversed;
        else {
            order = next;
            reversed = false;
        }
    }

    // Whether the first rows hold the largest values, for the caret.
    const descending = $derived((ORDERS.find((o) => o.order === order)?.descending ?? true) !== reversed);

    // Rows shown before "Show N more": the rest are mostly everyday reads.
    const SHOWN = 15;
    let showAll = $state(false);

    // The APIs come sorted by how identifying they are (see apiDetails).
    const inOrder = $derived(
        order === 'identifying'
            ? apis
            : order === 'rarest'
              ? [...apis].sort((a, b) => b.rarity - a.rarity || b.entropy - a.entropy || a.id.localeCompare(b.id))
              : order === 'kind'
              ? byKind(apis).flatMap((group) => group.rows)
              : order === 'name'
              ? [...apis].sort((a, b) => a.id.localeCompare(b.id))
              : order === 'calls'
              ? [...apis].sort((a, b) => b.calls - a.calls || a.id.localeCompare(b.id))
              : [...apis].sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity) || a.id.localeCompare(b.id))
    );
    // Turned around by kind, the kinds go from Z to A, each still with its most identifying APIs first.
    const sorted = $derived(!reversed ? inOrder : order === 'kind' ? byKind(apis, true).flatMap((group) => group.rows) : [...inOrder].reverse());
    const shown = $derived(showAll ? sorted : sorted.slice(0, SHOWN));

    /** APIs by kind, the kinds from A to Z (or Z to A), each with its most identifying APIs first. */
    function byKind(list: ApiDetail[], zToA = false): { kind: string; rows: ApiDetail[] }[] {
        const kinds = new Map<string, ApiDetail[]>();
        for (const api of list) kinds.set(api.kind, [...(kinds.get(api.kind) ?? []), api]);
        const groups = [...kinds].map(([kind, rows]) => ({ kind, rows })).sort((a, b) => a.kind.localeCompare(b.kind));
        return zToA ? groups.reverse() : groups;
    }

    // Headed by kind only in that order.
    // The rows shown regrouped in the same direction, so the headings keep the sorted order.
    const groups = $derived(order === 'kind' ? byKind(shown, reversed) : [{ kind: '', rows: shown }]);

    /** When an API was called, since the page started: "1.5 s", or "1.2–11.2 s" over a while. */
    function when(api: ApiDetail): string {
        if (api.first === null) return '';
        if (api.last === null || api.last - api.first < 100) return elapsed(api.first);
        const [first, last] = [elapsed(api.first), elapsed(api.last)];
        // One unit for both when they share it: "1.2–11.2 s".
        return first.endsWith(' s') && last.endsWith(' s') && !first.includes('min') && !last.includes('min') ? `${first.slice(0, -2)}–${last}` : `${first}–${last}`;
    }

    /** Its calls, and from how many places in the code when more than one: "6 calls from 5 places". */
    function calls(api: ApiDetail): string {
        return api.places > 1 ? `${plural(api.calls, 'call')} from ${api.places} places` : plural(api.calls, 'call');
    }

    const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

    /** How identifying it is, from its entropy in bits: "One browser in 64 (6 bits)". */
    function identifying(api: ApiDetail): string {
        const bits = Math.round(api.entropy * 8);
        if (bits < 1) return 'Hardly tells browsers apart';
        // Entropy stops at 1 (8 bits): such APIs tell browsers apart at least that finely.
        return `One browser in ${2 ** bits}${api.entropy >= 1 ? ' or more' : ''} (${plural(bits, 'bit')})`;
    }

    /** How common reading it is: the share of page loads using it (rarity is 1 minus that share, see FP_APIS). */
    function common(api: ApiDetail): string {
        const share = (1 - api.rarity) * 100;
        return share < 1 ? 'Under 1% of page loads' : `${Math.round(share)}% of page loads`;
    }
</script>

<div class="api-table">
    <div class="orders" role="group" aria-label="Sort APIs">
        {#each ORDERS as option (option.order)}
            {@const active = order === option.order}
            <button
                type="button"
                class="order"
                class:active
                aria-pressed={active}
                title={active ? 'Click to turn the order around' : `Sort by ${option.label.toLowerCase()}`}
                onclick={() => sortBy(option.order)}
            >
                {option.label}
                <!-- Both halves faint while inactive; the active one shows its direction. -->
                <span class="carets" aria-hidden="true">
                    <span class="up" class:on={active && !descending}></span>
                    <span class="down" class:on={active && descending}></span>
                </span>
            </button>
        {/each}
    </div>

    {#each groups as group (group.kind)}
        {#if group.kind}<h4 class="kind">{group.kind}</h4>{/if}
        <ul class="rows">
            {#each group.rows as api (api.id)}
                <!-- Left: what it is and how identifying; right: how much, when and how common. -->
                <li class="row squircle">
                    <span class="reveals">{capitalize(api.reveals || api.id)}</span>
                    <span class="calls">{calls(api)}</span>
                    <span class="name" title={api.id}>{api.id}</span>
                    <span class="when">{when(api)}</span>
                    <span class="trait" title="Its entropy: how much it tells this browser apart from others">{identifying(api)}</span>
                    <span class="trait right" title="How many page loads in Chrome read it (Chrome's usage statistics)">{common(api)}</span>
                </li>
            {/each}
        </ul>
    {/each}

    {#if sorted.length > SHOWN}
        <button type="button" class="more" class:open={showAll} onclick={() => (showAll = !showAll)}>
            {showAll ? 'Show less' : `Show ${sorted.length - SHOWN} more`}
        </button>
    {/if}
</div>

<style>
    .api-table {
        display: grid;
        gap: 12px;
    }

    /* The sort orders as quiet text buttons; the active one in the text color. */
    /* Spread across the whole width, like a table's column headings. */
    .orders {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 4px 10px;
    }

    .order {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    /* A small up and down triangle stacked, as in a table's sortable column. */
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

    .order:hover {
        color: var(--text);
    }

    .order.active {
        color: var(--text);
        font-weight: 600;
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
        display: grid;
        gap: 2px;
        margin: 0 -10px;
        padding: 0;
        list-style: none;
    }

    /* Two columns: what it reveals over the API's name, its calls over when they were made; the
       right column aligned, so times and counts line up from row to row. */
    .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: baseline;
        gap: 2px 12px;
        padding: 8px 10px;
        border-radius: 10px;
    }

    /* Every second row on a slightly lighter surface: the rows are told apart without lines. */
    .row:nth-child(even) {
        background: color-mix(in srgb, var(--surface), var(--text) 4%);
    }

    /* How identifying and how common it is, in the two columns like the lines above. */
    .trait {
        color: var(--muted);
        font-size: 12px;
    }

    .trait.right {
        text-align: right;
        white-space: nowrap;
    }

    .calls {
        text-align: right;
    }

    .reveals {
        font-size: 14px;
        font-weight: 500;
    }

    .calls {
        color: var(--muted);
        font-size: 14px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    /* The API's name: one line, cut at the end where the time leaves no room (the tooltip has it).
       Toned like a card's info lines: clearer than the facts around it, below what it reveals. */
    .name {
        overflow: hidden;
        color: color-mix(in srgb, var(--text) 70%, var(--muted));
        font-family: var(--mono);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .when {
        color: var(--muted);
        font-size: 12px;
    }

    .when {
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
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
