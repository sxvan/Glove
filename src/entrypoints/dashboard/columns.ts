export interface Column<Row> {
    key: string;
    label: string;
    title?: string;
    /** Lined up on the right, and sorted largest first at the first click. */
    numeric?: boolean;
    /** On one line, so the room goes to the long ones. */
    nowrap?: boolean;
    /** E.g. "30%", for text that wraps anywhere: by content alone, the others would leave it a narrow strip. */
    width?: string;
    /** Also when not a number, e.g. likely before possible identifiers. */
    largestFirst?: boolean;
    /** Null sorts last either way. */
    sortBy: (row: Row) => string | number | null;
}

export interface Sorting {
    key: string;
    descending: boolean;
}
