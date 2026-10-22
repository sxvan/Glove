<script lang="ts" generics="Row">
    // A table of rows, sorted by the column whose heading was clicked last; a second click on it
    // turns the order around. The caller draws the cells (`cell`, by row and column key) and filters
    // the rows; the table sorts them.
    import type { Snippet } from 'svelte';
    import type { Column, Sorting } from './columns';

    let {
        rows,
        columns,
        cell,
        sorting = $bindable(),
        empty,
    }: { rows: Row[]; columns: Column<Row>[]; cell: Snippet<[Row, string]>; sorting: Sorting; empty: string } = $props();

    const sorted = $derived.by(() => {
        const column = columns.find((c) => c.key === sorting.key);
        if (!column) return rows;
        // Array sorting keeps the order of equal rows, so ties stay as the caller listed them.
        return [...rows].sort((a, b) => compare(column.sortBy(a), column.sortBy(b), sorting.descending));
    });

    /** Text from A to Z, numbers by size, turned around when descending; null always last. */
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
            {#each sorted as row, i (i)}
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
    {/if}
</div>

<style>
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }

    /* The headings stay in view while the page scrolls through the rows. */
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

    /* Which way it is sorted: a small chevron, down for largest or Z first, up for the other way;
       hidden on the other columns until hovered. */
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

    /* Every second row on the fill, as in the popup's lists: rows told apart without lines. */
    tbody tr:nth-child(even) {
        background: var(--fill);
    }

    .empty {
        margin: 0;
        padding: 24px 12px;
        color: var(--muted);
    }
</style>
