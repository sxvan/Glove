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

// Wraps open/send on the prototype rather than replacing the XMLHttpRequest constructor,
// so static constants (XMLHttpRequest.DONE), subclassing and constructor identity keep working.
function hookXHR() {
    const proto = window.XMLHttpRequest?.prototype;
    if (!proto) {
        return;
    }

    const originalOpen: Hooked<XMLHttpRequest['open']> = proto.open;
    const originalSend: Hooked<XMLHttpRequest['send']> = proto.send;
    if (originalOpen.__is_hooked__ || originalSend.__is_hooked__) {
        return;
    }

    const openedRequests = new WeakMap<XMLHttpRequest, { url: string | null; method: string | null }>();

    // Calls with a non-XHR `this` skip recording, so the native method throws its usual error.
    const hookedOpen: Hooked<XMLHttpRequest['open']> = function (this: XMLHttpRequest, method: string, url: string | URL) {
        if (this instanceof XMLHttpRequest) {
            openedRequests.set(this, {
                method: method ? String(method) : null,
                url: url ? String(url) : null,
            });
        }

        return Reflect.apply(originalOpen, this, arguments);
    };

    const hookedSend: Hooked<XMLHttpRequest['send']> = function (this: XMLHttpRequest) {
        if (this instanceof XMLHttpRequest) {
            const request = openedRequests.get(this);
            recordHttpEvent('xhr', request?.url ?? null, request?.method ?? null, this.withCredentials ? 'include' : 'omit');
        }

        return Reflect.apply(originalSend, this, arguments);
    };

    hookedOpen.__is_hooked__ = true;
    hookedSend.__is_hooked__ = true;
    proto.open = hookedOpen;
    proto.send = hookedSend;
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
