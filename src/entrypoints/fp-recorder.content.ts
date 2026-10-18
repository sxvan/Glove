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
    createElement = Document.prototype.createElement;
    canvasWidth = nativeGetter(HTMLCanvasElement.prototype, 'width');
    canvasHeight = nativeGetter(HTMLCanvasElement.prototype, 'height');
    canvasSize = nativeSetters(HTMLCanvasElement.prototype, ['width', 'height']);

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
        innerLine: caller?.inner?.line ?? null,
        innerColumn: caller?.inner?.column ?? null,
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

    const revealsNothing = REVEALS_NOTHING[id];

    // Method syntax: like the browser's own methods, it has no prototype and can't be called with new.
    // Recorded once the call returned, as whether it revealed anything can depend on the result; a
    // call that threw is recorded as made.
    const wrapped = {
        [prop](this: unknown, ...args: unknown[]) {
            let result: unknown;
            let threw = true;
            try {
                result = reflectApply(original, this, args);
                threw = false;
                return result;
            } finally {
                if (threw || !revealsNothing?.(this, args, result, original)) {
                    recordFpEvent(reads.find((read) => isSpecialRead(read.readOf!.read, this, args))?.id ?? id, wrapped);
                }
            }
        },
    }[prop]!;

    proto[prop] = disguise(wrapped, original);
}

// ---------- calls that reveal nothing ----------
// Exporting a canvas nothing was drawn on reads nothing about the device, and isn't recorded:
// players and image code do it to check which formats the browser can encode (toDataURL("image/webp")
// on a new canvas, often after getContext("2d") to see that canvases work). Fingerprinting has to
// draw first, as a blank canvas looks the same everywhere, so comparing the export with a blank
// canvas's of the same size and format tells. Large canvases, beyond what fingerprinting or a format
// check uses, aren't compared, so an image editor's exports cost no extra blank one.

// Canvas pixels up to which an export is compared with a blank canvas's.
const BLANK_COMPARE_MAX_PIXELS = 1_000_000;

let createElement: typeof Document.prototype.createElement;
let canvasWidth: (canvas: unknown) => number | undefined;
let canvasHeight: (canvas: unknown) => number | undefined;
let canvasSize: (canvas: unknown, values: number[]) => void;

/** Whether a call (`self`, `args`) that returned `result` revealed nothing; `original` is the native method. */
const REVEALS_NOTHING: Record<string, (self: unknown, args: unknown[], result: unknown, original: Function) => boolean> = {
    'canvas.toDataURL': (canvas, args, result, original) => isBlankExport(canvas, args, result, original),
};

// What a blank canvas exports, by size and format: computed once each.
const blankExports = new Map<string, unknown>();

/** Whether toDataURL returned what a blank canvas of the same size and format does. Never throws. */
function isBlankExport(canvas: unknown, args: unknown[], result: unknown, toDataURL: Function): boolean {
    try {
        const [width, height] = [canvasWidth(canvas), canvasHeight(canvas)];
        if (typeof result !== 'string' || width === undefined || height === undefined || width * height > BLANK_COMPARE_MAX_PIXELS) return false;
        const key = `${width}x${height} ${String(args[0])} ${String(args[1])}`;
        if (!blankExports.has(key)) {
            const blank = reflectApply(createElement, document, ['canvas']);
            canvasSize(blank, [width, height]);
            blankExports.set(key, reflectApply(toDataURL, blank, args));
        }
        return blankExports.get(key) === result;
    } catch {
        return false;
    }
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

/** Sets properties through their native setters, in order (e.g. width and height); throws if that fails. */
function nativeSetters(proto: object, props: string[]): (target: unknown, values: unknown[]) => void {
    const setters = props.map((prop) => Object.getOwnPropertyDescriptor(proto, prop)?.set);
    return (target, values) => setters.forEach((set, i) => Reflect.apply(set!, target, [values[i]]));
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
