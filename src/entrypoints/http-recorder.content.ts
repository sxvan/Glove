import { defineContentScript } from 'wxt/utils/define-content-script';
import { createStackReader } from '@/lib/call-stack';
import { disguise, installDisguise, isDisguised } from '@/lib/disguise';
import { handOver, nativeGetter, reflectApply } from '@/lib/page-natives';
import { recordingDocument } from '@/lib/recording-document';
import type { RequestEvent } from '@/types/events';

// Runs in the page's main world so it can wrap the page's own ways of sending data.
export default defineContentScript({
    registration: 'runtime',
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    world: 'MAIN',

    main() {
        recordTo = recordingDocument();
        readStack = createStackReader(STACK_FRAMES);
        installDisguise();
        hookFetch();
        hookXHR();
        hookBeacon();
        hookImagePixels();
    },
});

// Monitoring, bot-protection and consent scripts often wrap fetch and XHR, so the script making a
// request can sit several frames below; requests are rare enough that reading deeper costs little.
const STACK_FRAMES = 30;

let readStack: ReturnType<typeof createStackReader>;
// The document whose bridge gets the events: this frame's, or the one a blank frame belongs to.
let recordTo: Document;

// Captured before page scripts run, so a page replacing it can't see or break the check.
const startsWith = String.prototype.startsWith;

// Only network requests can be matched to what the browser saw (see consolidateHttpEvents), and a
// data: address can hold a whole embedded response (YouTube's: 350 KB).
function isNetworkUrl(url: string | null): url is string {
    return url !== null && (reflectApply(startsWith, url, ['https:']) || reflectApply(startsWith, url, ['http:']));
}

/** @param wrapped whether a page script has replaced our wrapper with its own (see scriptsOnStack) */
function recordHttpEvent(id: RequestEvent['id'], url: string | null, method: string | null, credentials: string, hook: Function, wrapped: boolean) {
    if (!isNetworkUrl(url)) return;
    const scriptUrls = scriptsOnStack(hook, wrapped);
    const requestEvent: RequestEvent = {
        id: id,
        timeStamp: Date.now(),
        scriptUrl: scriptUrls[0] ?? null,
        scriptUrls,
        requestUrl: url,
        method: method,
        credentials: credentials,
    };

    handOver(recordTo, 'glove-request', requestEvent);
}

// Every script on the stack, as the one making the request may sit further out than helpers. A page
// script that replaced our wrapper with its own sees every request; it's left out unless it's alone.
function scriptsOnStack(hook: Function, wrapped: boolean): string[] {
    const scriptUrls = [...new Set(readStack(hook).map((location) => location.url))];
    return wrapped && scriptUrls.length > 1 ? scriptUrls.slice(1) : scriptUrls;
}

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

    // Method syntax: no prototype and not callable with new, like the original.
    const hookedFetch = {
        fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
            // Recording must never change what the page observes, so its errors are ignored.
            try {
                const { url, method, credentials } = describe(input, init);
                recordHttpEvent('fetch', url, method, credentials, hookedFetch, isReplaced(() => window.fetch, hookedFetch));
            } catch {}

            return reflectApply(originalFetch, this, arguments);
        },
    }.fetch;

    window.fetch = disguise(hookedFetch, originalFetch);
}

// Methods the Fetch standard normalizes to uppercase; others (e.g. "patch") are sent as written.
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);

// Without constructing a Request, which would consume a Request input's body and throw on invalid input.
function createFetchDescriber() {
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

    // Tracked only once the native open() succeeded, which proves `this` is a real XHR: invalid calls
    // reach the native methods untouched and emit no event.
    const hookedOpen = {
        open(this: XMLHttpRequest, method: string, url: string | URL) {
            const result = reflectApply(originalOpen, this, arguments);
            // Recording never keeps the page's request from going out.
            try {
                openedRequests.set(this, {
                    method: method ? String(method) : null,
                    url: url ? resolveUrl(String(url)) : null,
                });
            } catch {}

            return result;
        },
    }.open;

    const hookedSend = {
        send(this: XMLHttpRequest) {
            try {
                const request = openedRequests.get(this);
                if (request) {
                    openedRequests.delete(this);
                    const wrapped = isReplaced(() => proto.send, hookedSend) || isReplaced(() => proto.open, hookedOpen);
                    recordHttpEvent('xhr', request.url, request.method, this.withCredentials ? 'include' : 'omit', hookedSend, wrapped);
                }
            } catch {}

            return reflectApply(originalSend, this, arguments);
        },
    }.send;

    proto.open = disguise(hookedOpen, originalOpen) as XMLHttpRequest['open'];
    proto.send = disguise(hookedSend, originalSend);
}

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

            return reflectApply(originalBeacon, this, arguments) as boolean;
        },
    }.sendBeacon;

    proto.sendBeacon = disguise(hookedBeacon, originalBeacon);
}

// new Image().src = ".../pixel.gif?id=…": only addresses with a query; the page's HTML images never
// go through this setter.
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

                reflectApply(originalSet, this, [value]);
            },
        },
        'src'
    )!.set!;

    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set: disguise(hookedSet, originalSet) });
}
