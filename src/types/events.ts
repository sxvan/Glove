/** A call to a fingerprinting API, recorded in the page by the fp-recorder content script. */
export interface FpMonkeyEvent {
    id: string;
    timeStamp: number;
    scriptUrl: string | null;
    /** Position of the call in the script (1-based, as in stack traces); null if unknown. */
    line: number | null;
    column: number | null;
    /**
     * For calls from code the script generated at runtime (new Function, eval): that code and the
     * position in it. `line`/`column` are then where the script generated it.
     */
    generated: GeneratedPosition | null;
}

/** A position in code generated at runtime, identified by the code's hash as V8 reports it. */
export interface GeneratedPosition {
    hash: string;
    line: number;
    column: number;
}

/** A fetch/XHR call, recorded in the page by the http-recorder content script. */
export interface HttpMonkeyEvent {
    id: 'fetch' | 'xhr';
    timeStamp: number;
    scriptUrl: string | null;
    requestUrl: string | null;
    method: string | null;
    credentials: string;
}
