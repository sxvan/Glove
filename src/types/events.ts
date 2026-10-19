import type { StorageKind } from './snapshot';

/** A call to a fingerprinting API, recorded in the page by the fp-recorder content script. */
export interface FpMonkeyEvent {
    id: string;
    timeStamp: number;
    scriptUrl: string | null;
    /** Position of the call in the script (1-based, as in stack traces); null if unknown. */
    line: number | null;
    column: number | null;
    /**
     * True for calls from code the script generated at runtime (new Function, eval); `line` and
     * `column` are then where the script generated it.
     */
    generated: boolean;
    /** For generated code, the position of the call inside it; missing from an older recorder. */
    innerLine?: number | null;
    innerColumn?: number | null;
}

/** A request a script made (fetch, XHR, beacon, image pixel), recorded by the http-recorder content script. */
export interface HttpMonkeyEvent {
    id: 'fetch' | 'xhr' | 'beacon' | 'image';
    timeStamp: number;
    /** The innermost page script on the stack; often a wrapper around fetch or XHR (see scriptUrls). */
    scriptUrl: string | null;
    /** Every page script on the stack, innermost first; the request counts for each of them. */
    scriptUrls: string[];
    requestUrl: string | null;
    method: string | null;
    credentials: string;
}

/** A value a script stored in the browser (a cookie, local or session storage, IndexedDB), recorded by fp-recorder. */
export interface StorageMonkeyEvent {
    kind: StorageKind;
    /** The cookie's or item's name; for IndexedDB the database, the store and the key if given. */
    name: string;
    /** What was stored, cut to a length (see STORED_VALUE_MAX); null for IndexedDB records. */
    value: string | null;
    /** When a cookie expires (ms since the epoch); null for one kept until the browser closes, and for other storage. */
    expires: number | null;
    timeStamp: number;
    /** The innermost page script on the stack, as for API calls. */
    scriptUrl: string | null;
    line: number | null;
    column: number | null;
}
