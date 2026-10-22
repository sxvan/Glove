import type { StorageKind } from './snapshot';

export interface RecorderEvents {
    'glove-api-calls': ApiCallEvent[];
    'glove-storage': StorageWriteEvent[];
    'glove-request': RequestEvent;
}

export interface ApiCallEvent {
    id: string;
    timeStamp: number;
    scriptUrl: string | null;
    /** 1-based, as in stack traces; null if unknown. */
    line: number | null;
    column: number | null;
    /** From code generated at runtime (new Function, eval); `line` and `column` are then where it was generated. */
    generated: boolean;
    innerLine: number | null;
    innerColumn: number | null;
}

export interface RequestEvent {
    id: 'fetch' | 'xhr' | 'beacon' | 'image';
    timeStamp: number;
    /** Often a wrapper around fetch or XHR (see scriptUrls). */
    scriptUrl: string | null;
    /** Every page script on the stack, innermost first; the request counts for each of them. */
    scriptUrls: string[];
    requestUrl: string | null;
    method: string | null;
    credentials: string;
}

export interface StorageWriteEvent {
    kind: StorageKind;
    /** The cookie's or item's name; for IndexedDB the database, the store and the key if given. */
    name: string;
    /** What was stored, cut to a length (see STORED_VALUE_MAX); null for IndexedDB records. */
    value: string | null;
    /** When a cookie expires (ms since the epoch); null for one kept until the browser closes, and for other storage. */
    expires: number | null;
    timeStamp: number;
    scriptUrl: string | null;
    line: number | null;
    column: number | null;
}
