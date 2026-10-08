/** A call to a fingerprinting API, recorded in the page by the fp-recorder content script. */
export interface FpMonkeyEvent {
    id: string;
    timeStamp: number;
    scriptUrl: string | null;
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
