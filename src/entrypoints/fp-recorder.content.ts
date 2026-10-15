import { defineContentScript } from 'wxt/utils/define-content-script';
import { FP_APIS, type FpApiOwner } from '@/lib/fp-apis';
import type { FpMonkeyEvent } from '@/types/events';

type HookableFn = ((...args: any[]) => any) & { __is_hooked__?: boolean };

// Runs in the page's main world so it can wrap the page's own fingerprinting APIs.
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    world: 'MAIN',

    main() {
        installFpHooks();
    },
});

// Native functions the recorder relies on, captured in installFpHooks before page scripts run,
// so a page that patches them can't see, delay or break recording.
let nativeSetTimeout: (handler: () => void, timeout: number) => number;
let captureStackTrace: (target: object, skipAbove: Function) => void; // V8-specific

function installFpHooks() {
    nativeSetTimeout = window.setTimeout.bind(window);
    captureStackTrace = (Error as unknown as { captureStackTrace: typeof captureStackTrace }).captureStackTrace;

    for (const target of FP_APIS) {
        const proto = getProtoForOwner(target.owner);
        hookAny(proto, target.prop, target.id);
    }

    // Hand over buffered events before the page is unloaded or put into the back/forward cache.
    window.addEventListener('pagehide', flushFpEvents);

    console.log('FP hooks installed');
}

function getProtoForOwner(owner: FpApiOwner): any {
    switch (owner) {
        case 'Navigator':
            return Navigator.prototype;
        case 'Screen':
            return Screen.prototype;
        case 'Window':
            return window;
        case 'Document':
            return Document.prototype;
        case 'HTMLCanvasElement':
            return HTMLCanvasElement.prototype;
        case 'CanvasRenderingContext2D':
            return CanvasRenderingContext2D.prototype;
        case 'WebGLRenderingContext':
            return window.WebGLRenderingContext && WebGLRenderingContext.prototype;
        case 'WebGL2RenderingContext':
            return window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
        case 'AudioContext':
            return window.AudioContext && AudioContext.prototype;
        case 'OfflineAudioContext':
            return window.OfflineAudioContext && OfflineAudioContext.prototype;
        case 'AudioBuffer':
            return AudioBuffer.prototype;
        case 'MediaDevices':
            return navigator.mediaDevices;
        case 'RTCPeerConnection':
            return window.RTCPeerConnection && RTCPeerConnection.prototype;
        case 'IntlDateTimeFormat':
            return Intl.DateTimeFormat.prototype;
        default:
            return null;
    }
}

// Hooked APIs can be called thousands of times per second, so events are buffered and handed to
// the bridge in batches instead of one dispatch (and one extension message) per call.
const FLUSH_INTERVAL_MS = 100;

const pendingEvents: FpMonkeyEvent[] = [];
let flushScheduled = false;

/** @param hook the wrapper that was called; stack frames from it inward are skipped */
function recordFpEvent(id: string, hook: Function) {
    const caller = getCallerLocation(hook);
    pendingEvents.push({
        id: id,
        timeStamp: Date.now(),
        scriptUrl: caller?.url ?? null,
        line: caller?.line ?? null,
        column: caller?.column ?? null,
        generated: caller?.generated ?? false,
    });

    if (!flushScheduled) {
        flushScheduled = true;
        nativeSetTimeout(flushFpEvents, FLUSH_INTERVAL_MS);
    }
}

function flushFpEvents() {
    flushScheduled = false;
    if (pendingEvents.length === 0) {
        return;
    }

    const batch = pendingEvents.splice(0);
    document.documentElement.dispatchEvent(new CustomEvent('fp-monkey', { detail: batch }));
}

function hookAny(proto: any, prop: string, id: string) {
    if (!proto) {
        return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);

    if (descriptor && typeof descriptor.get === 'function') {
        hookGetter(proto, prop, id);
        return;
    }

    if (typeof proto[prop] === 'function') {
        hookMethod(proto, prop, id);
    }
}

function hookMethod(proto: any, prop: string, id: string) {
    const original: HookableFn | undefined = proto && proto[prop];
    if (typeof original !== 'function') {
        return;
    }

    if (original.__is_hooked__) {
        return;
    }

    const wrapped: HookableFn = function (this: unknown, ...args: unknown[]) {
        recordFpEvent(id, wrapped);
        return original.apply(this, args);
    };

    wrapped.__is_hooked__ = true;
    proto[prop] = wrapped;
}

function hookGetter(proto: any, prop: string, id: string) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    const original: HookableFn | undefined = descriptor?.get;
    if (!original || typeof original !== 'function') {
        return;
    }

    if (original.__is_hooked__) {
        return;
    }

    const wrapped: HookableFn = function (this: unknown) {
        recordFpEvent(id, wrapped);
        return original.apply(this);
    };

    wrapped.__is_hooked__ = true;

    Object.defineProperty(proto, prop, {
        ...descriptor,
        get: wrapped,
    });
}

// Frames kept per capture: the caller of the hook plus a few in case the first has no URL.
// Fewer frames saves formatting time; V8 still walks the whole stack, so deep stacks cost more.
const STACK_FRAMES = 4;

// URLs of scripts, as opposed to e.g. "" for generated code; the scheme can't contain "-", so
// extension URLs (chrome-extension://) don't match and the extension's own frames are skipped.
const SCRIPT_URL = /^(?:\w+:\/\/|blob:|data:|about:|file:)/;
// The script and position in an eval origin, e.g. "eval at f (https://example.com/a.js:1:200)".
const EVAL_ORIGIN = /((?:\w+:\/\/|blob:|data:|about:|file:).*?):(\d+):(\d+)\)/;

interface CallerLocation {
    url: string;
    line: number;
    column: number;
    /** True when the call came from code generated at runtime (new Function, eval). */
    generated: boolean;
}

/**
 * The script and position the hooked API was called from, taken from the first stack frame with a
 * URL. Code generated with new Function or eval has none; its calls count for the script that
 * generated it, at the place it did.
 */
function getCallerLocation(hook: Function): CallerLocation | null {
    for (const site of captureCallerSites(hook)) {
        const generated = site.isEval();
        const origin = generated ? EVAL_ORIGIN.exec(site.getEvalOrigin() ?? '') : null;
        const url = generated ? origin?.[1] : site.getFileName();
        const line = generated ? Number(origin?.[2]) : site.getLineNumber();
        const column = generated ? Number(origin?.[3]) : site.getColumnNumber();

        if (url && SCRIPT_URL.test(url) && line && column) return { url, line, column, generated };
    }

    return null;
}

/**
 * V8's structured stack frames (see https://v8.dev/docs/stack-trace-api). The browser's types don't
 * include them, as they're V8-specific; Node's types do, since Node runs on V8 as well.
 */
type CallSite = NodeJS.CallSite;

/** Captures the stack from the caller of `hook` on, leaving out the extension's own frames. */
function captureCallerSites(hook: Function): CallSite[] {
    const holder: { stack?: CallSite[] } = {};
    const savedLimit = Error.stackTraceLimit;
    const savedPrepare = Error.prepareStackTrace;
    let sites: CallSite[] | undefined;

    // Assigning can throw if the page froze Error; the capture then fails or uses the page's limit.
    try {
        Error.stackTraceLimit = STACK_FRAMES;
        Error.prepareStackTrace = (_error, callSites) => callSites;
    } catch {}

    try {
        captureStackTrace(holder, hook);
        // The stack is prepared when first read, so it has to be read before restoring.
        sites = holder.stack;
    } catch {
    } finally {
        try {
            Error.stackTraceLimit = savedLimit;
            Error.prepareStackTrace = savedPrepare;
        } catch {}
    }

    return Array.isArray(sites) ? sites : [];
}
