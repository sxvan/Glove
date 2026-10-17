import { defineContentScript } from 'wxt/utils/define-content-script';
import { createStackReader } from '@/lib/call-stack';
import { disguise, installDisguise, isDisguised } from '@/lib/disguise';
import type { HttpMonkeyEvent } from '@/types/events';

// Runs in the page's main world so it can wrap the page's own ways of sending data: fetch,
// XMLHttpRequest, beacons and image pixels.
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    world: 'MAIN',

    main() {
        readStack = createStackReader(STACK_FRAMES);
        installDisguise();
        hookFetch();
        hookXHR();
        hookBeacon();
        hookImagePixels();
    },
});

// Frames read per request. Monitoring, bot-protection and consent scripts often wrap fetch and
// XMLHttpRequest, so the script that made a request can sit several frames below their wrappers;
// requests are rare enough that reading deeper costs little.
const STACK_FRAMES = 30;

let readStack: ReturnType<typeof createStackReader>;

/**
 * @param hook our wrapper that was called; stack frames from it inward are skipped
 * @param wrapped whether a page script has replaced our wrapper with its own (see scriptsOnStack)
 */
function recordHttpEvent(id: HttpMonkeyEvent['id'], url: string | null, method: string | null, credentials: string, hook: Function, wrapped: boolean) {
    const scriptUrls = scriptsOnStack(hook, wrapped);
    const httpMonkeyEvent: HttpMonkeyEvent = {
        id: id,
        timeStamp: Date.now(),
        scriptUrl: scriptUrls[0] ?? null,
        scriptUrls,
        requestUrl: url,
        method: method,
        credentials: credentials,
    };

    document.documentElement.dispatchEvent(new CustomEvent('http-monkey', { detail: httpMonkeyEvent }));
}

/**
 * The page scripts a request counts for: every script on the stack, as the one that made it may sit
 * further out than helpers. Monitoring, bot-protection and consent scripts often replace fetch, XHR
 * or sendBeacon with their own wrapper around ours; then every request passes through them, and the
 * innermost script is that wrapper rather than the one making the request. It's left out then, unless
 * it's the only script, i.e. its own request.
 */
function scriptsOnStack(hook: Function, wrapped: boolean): string[] {
    const scriptUrls = [...new Set(readStack(hook).map((location) => location.url))];
    return wrapped && scriptUrls.length > 1 ? scriptUrls.slice(1) : scriptUrls;
}

/** Whether the function `current` reads is no longer our hook, i.e. a page script replaced it. */
function isReplaced(current: () => unknown, hook: Function): boolean {
    try {
        return current() !== hook;
    } catch {
        return false;
    }
}

function hookFetch() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function' || isDisguised(originalFetch)) {
        return;
    }

    const describe = createFetchDescriber();

    // Method syntax, as for all hooks: no prototype and not callable with new, like the original
    // (see disguise).
    const hookedFetch = {
        fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
            // Recording must never change what the page observes, so its errors are ignored.
            try {
                const { url, method, credentials } = describe(input, init);
                recordHttpEvent('fetch', url, method, credentials, hookedFetch, isReplaced(() => window.fetch, hookedFetch));
            } catch {}

            return Reflect.apply(originalFetch, this, arguments);
        },
    }.fetch;

    window.fetch = disguise(hookedFetch, originalFetch);
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

    const originalOpen = proto.open;
    const originalSend = proto.send;
    if (isDisguised(originalOpen) || isDisguised(originalSend)) {
        return;
    }

    const openedRequests = new WeakMap<XMLHttpRequest, { url: string | null; method: string | null }>();

    // A request is only tracked once the native open() has succeeded, which also proves `this`
    // is a real XHR. send() records only tracked requests, so invalid calls (non-XHR `this`,
    // send without open, repeated send) reach the native method untouched and emit no event.
    const hookedOpen = {
        open(this: XMLHttpRequest, method: string, url: string | URL) {
            const result = Reflect.apply(originalOpen, this, arguments);

            openedRequests.set(this, {
                method: method ? String(method) : null,
                url: url ? resolveUrl(String(url)) : null,
            });

            return result;
        },
    }.open;

    const hookedSend = {
        send(this: XMLHttpRequest) {
            const request = openedRequests.get(this);
            if (request) {
                openedRequests.delete(this);
                const wrapped = isReplaced(() => proto.send, hookedSend) || isReplaced(() => proto.open, hookedOpen);
                recordHttpEvent('xhr', request.url, request.method, this.withCredentials ? 'include' : 'omit', hookedSend, wrapped);
            }

            return Reflect.apply(originalSend, this, arguments);
        },
    }.send;

    proto.open = disguise(hookedOpen, originalOpen) as XMLHttpRequest['open'];
    proto.send = disguise(hookedSend, originalSend);
}

/** navigator.sendBeacon: made for sending data, e.g. as the page is left. */
function hookBeacon() {
    const proto = window.Navigator?.prototype;
    const originalBeacon = proto?.sendBeacon;
    if (!proto || typeof originalBeacon !== 'function' || isDisguised(originalBeacon)) {
        return;
    }

    const hookedBeacon = {
        sendBeacon(this: Navigator, url: string | URL) {
            try {
                recordHttpEvent('beacon', resolveUrl(String(url)), 'POST', 'include', hookedBeacon, isReplaced(() => navigator.sendBeacon, hookedBeacon));
            } catch {}

            return Reflect.apply(originalBeacon, this, arguments) as boolean;
        },
    }.sendBeacon;

    proto.sendBeacon = disguise(hookedBeacon, originalBeacon);
}

/**
 * Image pixels: a script setting an image's address to send what it collected in the query, e.g.
 * new Image().src = ".../pixel.gif?id=…". Only addresses with a query are recorded; images from the
 * page's HTML don't go through this setter at all.
 */
function hookImagePixels() {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const originalSet = descriptor?.set;
    if (!descriptor || typeof originalSet !== 'function' || isDisguised(originalSet)) {
        return;
    }

    // A setter of an object literal, like the browser's own: named "set src", without prototype.
    const hookedSet = Object.getOwnPropertyDescriptor(
        {
            set src(value: string) {
                try {
                    const url = resolveUrl(String(value));
                    if (url && url.includes('?')) recordHttpEvent('image', url, 'GET', 'include', hookedSet, false);
                } catch {}

                Reflect.apply(originalSet, this, [value]);
            },
        },
        'src'
    )!.set!;

    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set: disguise(hookedSet, originalSet) });
}
