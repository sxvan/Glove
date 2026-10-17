import { defineContentScript } from 'wxt/utils/define-content-script';
import { FP_APIS, type FpApiOwner, type SpecialRead } from '@/lib/fp-apis';
import { createStackReader, type StackLocation } from '@/lib/call-stack';
import { disguise, installDisguise, isDisguised } from '@/lib/disguise';
import type { FpMonkeyEvent } from '@/types/events';

// Captured before page scripts run, so a page replacing it can't see the hooks' calls.
const reflectApply = Reflect.apply;

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
let readStack: (hook: Function) => StackLocation[];

function installFpHooks() {
    installDisguise();
    nativeSetTimeout = window.setTimeout.bind(window);
    readStack = createStackReader(STACK_FRAMES);
    isConnected = nativeGetter(Node.prototype, 'isConnected');
    contextCanvas = nativeGetter(CanvasRenderingContext2D.prototype, 'canvas');
    contextFont = nativeGetter(CanvasRenderingContext2D.prototype, 'font');

    for (const target of FP_APIS) {
        // Particular reads through another API are recognized by that API's hook.
        if (target.readOf) continue;
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
        case 'NavigatorUAData':
            return (window as { NavigatorUAData?: { prototype: unknown } }).NavigatorUAData?.prototype ?? null;
        case 'GPU':
        case 'GPUAdapter':
        case 'SpeechSynthesis':
        case 'Keyboard':
        case 'StorageManager':
        case 'NetworkInformation':
            // Not in every browser or context (WebGPU and the keyboard need a secure context).
            return (window as unknown as Record<string, { prototype: unknown } | undefined>)[owner]?.prototype ?? null;
        case 'Date':
            return Date.prototype;
        case 'Performance':
            return window.Performance?.prototype ?? null;
        case 'HTMLMediaElement':
            return window.HTMLMediaElement?.prototype ?? null;
        case 'MediaSource':
            // isTypeSupported is static: on the constructor, not its prototype.
            return (window as { MediaSource?: unknown }).MediaSource ?? null;
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
    const original: unknown = proto && proto[prop];
    if (typeof original !== 'function' || isDisguised(original)) {
        return;
    }

    // Particular reads through this method, recorded under their own id (e.g. the GPU name).
    const reads = FP_APIS.filter((api) => api.readOf?.api === id);

    // Method syntax: like the browser's own methods, it has no prototype and can't be called with new.
    const wrapped = {
        [prop](this: unknown, ...args: unknown[]) {
            recordFpEvent(reads.find((read) => isSpecialRead(read.readOf!.read, this, args))?.id ?? id, wrapped);
            return reflectApply(original, this, args);
        },
    }[prop]!;

    proto[prop] = disguise(wrapped, original);
}

// ---------- particular reads (see SpecialRead) ----------

// WEBGL_debug_renderer_info's parameters: the graphics card's maker and model.
const UNMASKED_VENDOR_WEBGL = 0x9245;
const UNMASKED_RENDERER_WEBGL = 0x9246;
// Client hints beyond the everyday brands and platform.
const DETAILED_HINTS = new Set(['architecture', 'bitness', 'formFactors', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion', 'wow64']);
// Different fonts measured on one canvas context from which it counts as probing for fonts.
const FONT_PROBING_MIN_FONTS = 8;

let isConnected: (node: unknown) => boolean | undefined;
let contextCanvas: (context: unknown) => unknown;
let contextFont: (context: unknown) => string | undefined;
const fontsByContext = new WeakMap<object, Set<string>>();

/** Whether a call (`self`, `args`) is the particular read. Never throws. */
function isSpecialRead(read: SpecialRead, self: unknown, args: unknown[]): boolean {
    try {
        switch (read) {
            case 'gpuName':
                return args[0] === UNMASKED_VENDOR_WEBGL || args[0] === UNMASKED_RENDERER_WEBGL;
            case 'highEntropyValues':
                return Array.isArray(args[0]) && args[0].some((hint) => DETAILED_HINTS.has(String(hint)));
            case 'hiddenCanvas': {
                // A context's canvas, or the canvas itself.
                const canvas = contextCanvas(self) ?? self;
                return isConnected(canvas) === false;
            }
            case 'fontProbing': {
                const font = contextFont(self);
                if (!font || typeof self !== 'object' || self === null) return false;
                const fonts = fontsByContext.get(self) ?? new Set<string>();
                fonts.add(font);
                fontsByContext.set(self, fonts);
                return fonts.size >= FONT_PROBING_MIN_FONTS;
            }
        }
    } catch {
        return false;
    }
}

/** Reads a property through its native getter, so a page can't fake it; undefined if that fails. */
function nativeGetter<T>(proto: object, prop: string): (target: unknown) => T | undefined {
    const get = Object.getOwnPropertyDescriptor(proto, prop)?.get;
    return (target) => {
        if (!get || target === null || typeof target !== 'object') return undefined;
        try {
            return Reflect.apply(get, target, []) as T;
        } catch {
            return undefined;
        }
    };
}

function hookGetter(proto: any, prop: string, id: string) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    const original = descriptor?.get;
    if (typeof original !== 'function' || isDisguised(original)) {
        return;
    }

    // A getter of an object literal, like the browser's own: named "get width", without prototype.
    const wrapped = Object.getOwnPropertyDescriptor(
        {
            get [prop]() {
                recordFpEvent(id, wrapped);
                return reflectApply(original, this, []);
            },
        },
        prop
    )!.get!;

    Object.defineProperty(proto, prop, {
        ...descriptor,
        get: disguise(wrapped, original),
    });
}

// Frames kept per capture: the caller of the hook plus a few in case the first has no URL.
// Fewer frames saves formatting time; V8 still walks the whole stack, so deep stacks cost more.
const STACK_FRAMES = 4;

/** The script and position the hooked API was called from: the first page script on the stack. */
function getCallerLocation(hook: Function): StackLocation | null {
    return readStack(hook)[0] ?? null;
}
