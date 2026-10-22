/** A column of a table (see DataTable): its heading, and what its cells sort by. */
export interface Column<Row> {
    key: string;
    label: string;
    /** What the column holds, for the heading's tooltip. */
    title?: string;
    /** Numbers: lined up on the right, and sorted largest first at the first click. */
    numeric?: boolean;
    /** Short values on one line, e.g. "Local storage": the room goes to the long ones. */
    nowrap?: boolean;
    /**
     * The share of the table's width it is given, e.g. "30%", for a column of long text that can wrap
     * anywhere: by their content alone, the other columns would leave it a narrow strip.
     */
    width?: string;
    /** Sorted largest first at the first click, also when not a number (e.g. likely before possible identifiers). */
    largestFirst?: boolean;
    /** The value it sorts by: text from A to Z, numbers by size. Null, nothing to show, sorts last either way. */
    sortBy: (row: Row) => string | number | null;
}

/** Which column a table is sorted by, and which way. */
export interface Sorting {
    key: string;
    descending: boolean;
}
