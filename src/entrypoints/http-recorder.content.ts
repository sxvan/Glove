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

    const describe = createFetchDescriber();

    const hookedFetch: Hooked<typeof fetch> = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        // Recording must never change what the page observes, so its errors are ignored.
        try {
            const { url, method, credentials } = describe(input, init);
            recordHttpEvent('fetch', url, method, credentials);
        } catch {}

        return Reflect.apply(originalFetch, this, arguments);
    };

    hookedFetch.__is_hooked__ = true;
    window.fetch = hookedFetch;
}

// Methods the Fetch standard normalizes to uppercase; others (e.g. "patch") are sent as written.
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);

/**
 * Derives what fetch() will request without constructing a Request, which would consume the
 * body of a Request input and throw synchronously on invalid input.
 */
function createFetchDescriber() {
    // Captured at install time, before page scripts run, so replaced globals can't affect them.
    const requestUrl = nativeGetter<string>(Request.prototype, 'url');
    const requestMethod = nativeGetter<string>(Request.prototype, 'method');
    const requestCredentials = nativeGetter<string>(Request.prototype, 'credentials');
    const urlHref = nativeGetter<string>(URL.prototype, 'href');

    return (input: unknown, init: unknown): { url: string | null; method: string; credentials: string } => {
        const url: string | null = requestUrl(input) ?? urlHref(input) ?? (typeof input === 'string' ? resolveUrl(input) : null);
        let method = requestMethod(input) ?? 'GET';
        let credentials = requestCredentials(input) ?? 'same-origin';

        if (init !== null && typeof init === 'object') {
            const { method: initMethod, credentials: initCredentials } = init as RequestInit;
            if (typeof initMethod === 'string') {
                method = NORMALIZED_METHODS.has(initMethod.toUpperCase()) ? initMethod.toUpperCase() : initMethod;
            }
            if (typeof initCredentials === 'string') {
                credentials = initCredentials;
            }
        }

        return { url, method, credentials };
    };
}

function resolveUrl(url: string): string | null {
    try {
        return new URL(url, document.baseURI).href;
    } catch {
        return null;
    }
}

/**
 * Returns a reader for a native getter. Reading through the original getter doubles as a brand
 * check: it throws (and the reader returns undefined) unless `target` is a genuine instance.
 */
function nativeGetter<T>(proto: object, prop: string): (target: unknown) => T | undefined {
    const get = Object.getOwnPropertyDescriptor(proto, prop)?.get;

    return (target) => {
        if (!get || target === null || typeof target !== 'object') {
            return undefined;
        }

        try {
            return Reflect.apply(get, target, []) as T;
        } catch {
            return undefined;
        }
    };
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

    // A request is only tracked once the native open() has succeeded, which also proves `this`
    // is a real XHR. send() records only tracked requests, so invalid calls (non-XHR `this`,
    // send without open, repeated send) reach the native method untouched and emit no event.
    const hookedOpen: Hooked<XMLHttpRequest['open']> = function (this: XMLHttpRequest, method: string, url: string | URL) {
        const result = Reflect.apply(originalOpen, this, arguments);

        openedRequests.set(this, {
            method: method ? String(method) : null,
            url: url ? String(url) : null,
        });

        return result;
    };

    const hookedSend: Hooked<XMLHttpRequest['send']> = function (this: XMLHttpRequest) {
        const request = openedRequests.get(this);
        if (request) {
            openedRequests.delete(this);
            recordHttpEvent('xhr', request.url, request.method, this.withCredentials ? 'include' : 'omit');
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
