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
