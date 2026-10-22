<script lang="ts" generics="Row">
    // With `pageSize`, it shows that many rows and more on request: a page's thousands of calls would
    // take long to draw at once.
    import { untrack, type Snippet } from 'svelte';
    import type { Column, Sorting } from './columns';

    let {
        rows,
        columns,
        cell,
        sorting = $bindable(),
        empty,
        pageSize,
    }: { rows: Row[]; columns: Column<Row>[]; cell: Snippet<[Row, string]>; sorting: Sorting; empty: string; pageSize?: number } = $props();

    let shown = $state(untrack(() => pageSize ?? Infinity));

    const sorted = $derived.by(() => {
        const column = columns.find((c) => c.key === sorting.key);
        if (!column) return rows;
        // Stable, so ties stay as the caller listed them.
        return [...rows].sort((a, b) => compare(column.sortBy(a), column.sortBy(b), sorting.descending));
    });

    /** Null always last. */
    function compare(a: string | number | null, b: string | number | null, descending: boolean): number {
        if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
        const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
        return descending ? -order : order;
    }

    function sortBy(column: Column<Row>) {
        sorting = sorting.key === column.key ? { key: column.key, descending: !sorting.descending } : { key: column.key, descending: !!(column.largestFirst ?? column.numeric) };
    }
</script>

<div>
    <table>
        <thead>
            <tr>
                {#each columns as column (column.key)}
                    <th class:numeric={column.numeric} style:width={column.width} aria-sort={sorting.key === column.key ? (sorting.descending ? 'descending' : 'ascending') : undefined}>
                        <button type="button" title={column.title} onclick={() => sortBy(column)}>
                            {column.label}<span class="arrow" class:on={sorting.key === column.key} class:up={sorting.key === column.key && !sorting.descending} aria-hidden="true"></span>
                        </button>
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody>
            {#each sorted.slice(0, shown) as row, i (i)}
                <tr>
                    {#each columns as column (column.key)}
                        <td class:numeric={column.numeric} class:nowrap={column.nowrap}>{@render cell(row, column.key)}</td>
                    {/each}
                </tr>
            {/each}
        </tbody>
    </table>
    {#if rows.length === 0}
        <p class="empty">{empty}</p>
    {:else if pageSize && sorted.length > shown}
        <p class="more">
            {shown.toLocaleString('en-US')} of {sorted.length.toLocaleString('en-US')} shown
            <button type="button" class="button" onclick={() => (shown += pageSize)}>Show {Math.min(pageSize, sorted.length - shown).toLocaleString('en-US')} more</button>
        </p>
    {/if}
</div>

<style>
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }

    th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 0;
        background: var(--surface);
        color: var(--muted);
        font-size: 12px;
        font-weight: 500;
        text-align: left;
        white-space: nowrap;
    }

    th button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 10px 12px;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: inherit;
        cursor: pointer;
    }

    th.numeric button {
        justify-content: flex-end;
    }

    th button:hover,
    th[aria-sort] button {
        color: var(--text);
    }

    /* Down for largest or Z first; hidden on the other columns until hovered. */
    .arrow {
        width: 5px;
        height: 5px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        opacity: 0;
        transform: translateY(-2px) rotate(45deg);
    }

    .arrow.up {
        transform: translateY(1px) rotate(-135deg);
    }

    .arrow.on,
    th button:hover .arrow {
        opacity: 1;
    }

    td {
        padding: 8px 12px;
        vertical-align: top;
    }

    td.numeric {
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    td.numeric,
    td.nowrap {
        white-space: nowrap;
    }

    /* Rows told apart without lines, as in the popup's lists. */
    tbody tr:nth-child(even) {
        background: var(--fill);
    }

    .empty {
        margin: 0;
        padding: 24px 12px;
        color: var(--muted);
    }

    .more {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        padding: 16px 12px 10px;
        color: var(--muted);
        font-size: 12px;
    }

</style>
