import { defineContentScript } from 'wxt/utils/define-content-script';
import type { HttpMonkeyEvent } from '@/types/events';

type Hooked<T> = T & { __is_hooked__?: boolean };

// Runs in the page's main world so it can wrap the page's own fetch and XMLHttpRequest.
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    world: 'MAIN',

    main() {
        hookFetch();
        hookXHR();
    },
});

function recordHttpEvent(id: HttpMonkeyEvent['id'], url: string | null, method: string | null, credentials: string) {
    const httpMonkeyEvent: HttpMonkeyEvent = {
        id: id,
        timeStamp: Date.now(),
        scriptUrl: getCallerScriptUrl(),
        requestUrl: url,
        method: method,
        credentials: credentials,
    };

    document.documentElement.dispatchEvent(new CustomEvent('http-monkey', { detail: httpMonkeyEvent }));
}

function hookFetch() {
    const originalFetch: Hooked<typeof fetch> = window.fetch;
    if (typeof originalFetch !== 'function') {
        return;
    }

    if (originalFetch.__is_hooked__) {
        return;
    }

    const hookedFetch: Hooked<typeof fetch> = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        let req: Request;

        if (input instanceof Request) {
            req = init ? new Request(input, init) : input;
        } else {
            req = new Request(input, init);
        }

        recordHttpEvent('fetch', req.url, req.method, req.cache);

        return Reflect.apply(originalFetch, this, arguments);
    };

    hookedFetch.__is_hooked__ = true;
    window.fetch = hookedFetch;
}

function hookXHR() {
    const OriginalXHR = window.XMLHttpRequest;
    if (typeof OriginalXHR !== 'function') {
        return;
    }

    function HookedXHR() {
        const xhr = new OriginalXHR();

        let url: string | null = null;
        let method: string | null = null;

        const originalOpen = xhr.open;

        xhr.open = function (this: XMLHttpRequest, m: string, u: string | URL) {
            method = m ? String(m) : null;
            url = u ? String(u) : null;

            return Reflect.apply(originalOpen, this, arguments);
        };

        const originalSend = xhr.send;
        xhr.send = function (this: XMLHttpRequest) {
            recordHttpEvent('xhr', url, method, xhr.withCredentials ? 'include' : 'omit');

            return Reflect.apply(originalSend, this, arguments);
        };

        return xhr;
    }

    HookedXHR.prototype = OriginalXHR.prototype;
    const hookedXHR = HookedXHR as unknown as Hooked<typeof XMLHttpRequest>;
    hookedXHR.__is_hooked__ = true;
    window.XMLHttpRequest = hookedXHR;
}

function getCallerScriptUrl(): string | null {
    const err = new Error();

    if (!err.stack) {
        return null;
    }

    const lines = err.stack.split('\n').slice(1); // skip "Error" line

    for (const line of lines) {
        const m = line.match(/\(?(\w+:\/\/[^):]+):(\d+):(\d+)\)?$/);
        if (!m) {
            continue;
        }

        const url = m[1]!;

        // skip extension scripts (see fp-recorder for why this matches "chrome-extension://")
        if (url.startsWith('extension://')) {
            continue;
        }

        return url;
    }

    return null;
}
