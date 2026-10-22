import { defineContentScript } from 'wxt/utils/define-content-script';
import { FP_APIS, type FpApiOwner, type SpecialRead } from '@/lib/fp-apis';
import { createStackReader, type StackLocation } from '@/lib/call-stack';
import { disguise, installDisguise, isDisguised } from '@/lib/disguise';
import type { FpMonkeyEvent, StorageMonkeyEvent } from '@/types/events';
import type { StorageKind } from '@/types/snapshot';
import { STORED_VALUE_MAX } from '@/lib/identifiers';
import { handOver, nativeGetter, nativeSetters, reflectApply } from '@/lib/page-natives';
import { recordingDocument } from '@/lib/recording-document';

// Runs in the page's main world so it can wrap the page's own fingerprinting APIs.
// Registered by the background, which leaves out the sites the extension is off for (see lib/recorders).
export default defineContentScript({
    registration: 'runtime',
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

// Captured in installFpHooks, before page scripts run (see lib/page-natives).
let nativeSetTimeout: (handler: () => void, timeout: number) => number;
let readStack: (hook: Function) => StackLocation[];
// The document whose bridge gets the events: this frame's, or the one a blank frame belongs to.
let recordTo: Document;

function installFpHooks() {
    installDisguise();
    recordTo = recordingDocument();
    nativeSetTimeout = window.setTimeout.bind(window);
    readStack = createStackReader(STACK_FRAMES);
    isConnected = nativeGetter(Node.prototype, 'isConnected');
    contextCanvas = nativeGetter(CanvasRenderingContext2D.prototype, 'canvas');
    const font2d = nativeGetter<string>(CanvasRenderingContext2D.prototype, 'font');
    const offscreen2d = (window as { OffscreenCanvasRenderingContext2D?: { prototype: object } }).OffscreenCanvasRenderingContext2D;
    const fontOffscreen = offscreen2d ? nativeGetter<string>(offscreen2d.prototype, 'font') : () => undefined;
    // A canvas's context or an OffscreenCanvas's: each has its own getter, failing on the other.
    contextFont = (context) => font2d(context) ?? fontOffscreen(context);
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
    installStorageHooks();

    // Hand over buffered events before the page is unloaded or put into the back/forward cache.
    window.addEventListener('pagehide', flushFpEvents);
}

function getProtoForOwner(owner: FpApiOwner): object | null {
    switch (owner) {
        case 'Window':
            return window;
        case 'IntlDateTimeFormat':
            return Intl.DateTimeFormat.prototype;
        case 'MediaSource':
            // isTypeSupported is static: on the constructor, not its prototype.
            return (window as { MediaSource?: object }).MediaSource ?? null;
        default:
            // Not every owner is in every browser or context (WebGPU and the keyboard need a secure context).
            return (window as unknown as Record<string, { prototype?: object } | undefined>)[owner]?.prototype ?? null;
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
    scheduleFlush();
}

function flushFpEvents() {
    flushScheduled = false;
    if (pendingEvents.length > 0) {
        handOver(recordTo, 'fp-monkey', pendingEvents.splice(0));
    }
    if (pendingStored.length > 0) {
        handOver(recordTo, 'storage-monkey', pendingStored.splice(0));
    }
}

function scheduleFlush() {
    if (!flushScheduled) {
        flushScheduled = true;
        nativeSetTimeout(flushFpEvents, FLUSH_INTERVAL_MS);
    }
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

// Frames read per call: the caller of the hook plus a few in case the first has no URL. V8 stops
// walking the stack once it has that many, so a hook called thousands of times stays cheap.
const STACK_FRAMES = 4;

/** The script and position the hooked API was called from: the first page script on the stack. */
function getCallerLocation(hook: Function): StackLocation | null {
    return readStack(hook)[0] ?? null;
}

// ---------- what scripts store ----------
// Writes to cookies and the page's storage, by the script that made them, buffered and handed over
// with the API calls: a script can keep the identifier it computed there, so it needn't fingerprint
// again, and a cookie keeps being sent after the script is blocked. Only writes through the hooked
// calls are seen: `localStorage.id = value` assigns without one. Shown as recorded, for the user to
// see; what the browser holds can differ, e.g. after a cookie was rejected or deleted.
// A write counts for the innermost page script on the stack, as an API call does; a framework that
// wraps the storage calls for the whole page is then credited with the writes passing through it.

const pendingStored: StorageMonkeyEvent[] = [];

// The page's storages, to tell which one setItem was called on; null where they can't be used,
// e.g. in a sandboxed frame.
let localStorageOf: Storage | null = null;
let sessionStorageOf: Storage | null = null;
let storeName: (store: unknown) => string | undefined;
let storeTransaction: (store: unknown) => IDBTransaction | undefined;
let transactionDb: (transaction: unknown) => IDBDatabase | undefined;
let databaseName: (database: unknown) => string | undefined;

function installStorageHooks() {
    try {
        localStorageOf = window.localStorage;
    } catch {}
    try {
        sessionStorageOf = window.sessionStorage;
    } catch {}
    storeName = nativeGetter(IDBObjectStore.prototype, 'name');
    storeTransaction = nativeGetter(IDBObjectStore.prototype, 'transaction');
    transactionDb = nativeGetter(IDBTransaction.prototype, 'db');
    databaseName = nativeGetter(IDBDatabase.prototype, 'name');

    // document.cookie = "name=value; max-age=…"
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    const setCookie = cookie?.set;
    if (cookie && setCookie && !isDisguised(setCookie)) {
        const wrapped = Object.getOwnPropertyDescriptor(
            {
                set cookie(value: unknown) {
                    reflectApply(setCookie, this, [value]);
                    if (typeof value === 'string') recordCookie(value, wrapped);
                },
            },
            'cookie'
        )!.set!;
        Object.defineProperty(Document.prototype, 'cookie', { ...cookie, set: disguise(wrapped, setCookie) });
    }

    // cookieStore.set(name, value) or cookieStore.set({ name, value, expires })
    const cookieStore = (window as { CookieStore?: { prototype: object } }).CookieStore?.prototype;
    hookStorageMethod(cookieStore, 'set', (_, args) => {
        const [first, second] = args;
        if (typeof first === 'string') return { kind: 'cookie', name: first, value: String(second ?? ''), expires: null };
        if (!first || typeof first !== 'object') return null;
        const { name, value, expires } = first as { name?: unknown; value?: unknown; expires?: unknown };
        if (typeof expires === 'number' && expires <= Date.now()) return null;
        return { kind: 'cookie', name: String(name ?? ''), value: String(value ?? ''), expires: typeof expires === 'number' ? expires : null };
    });

    hookStorageMethod(Storage.prototype, 'setItem', (storage, args) => {
        const kind = storageKind(storage);
        return kind && { kind, name: String(args[0]), value: String(args[1]), expires: null };
    });

    // A record put into a database's store: named by the database, the store and its key if given.
    for (const method of ['put', 'add']) {
        hookStorageMethod(IDBObjectStore.prototype, method, (store, args) => {
            const database = databaseName(transactionDb(storeTransaction(store)));
            const key = args[1];
            const name = [database, storeName(store), typeof key === 'string' || typeof key === 'number' ? key : null].filter((part) => part != null).join(' › ');
            return { kind: 'indexedDB', name, value: null, expires: null };
        });
    }
}

type StoredWrite = Pick<StorageMonkeyEvent, 'kind' | 'name' | 'value' | 'expires'>;

function storageKind(storage: unknown): StorageKind | null {
    return storage === localStorageOf ? 'localStorage' : storage === sessionStorageOf ? 'sessionStorage' : null;
}

/** Wraps a method that stores something; `describe` tells what from its arguments, or null to skip it. */
function hookStorageMethod(proto: any, prop: string, describe: (self: unknown, args: unknown[]) => StoredWrite | null) {
    const original: unknown = proto && proto[prop];
    if (typeof original !== 'function' || isDisguised(original)) return;

    // Recorded once the call returned: one that threw stored nothing.
    const wrapped = {
        [prop](this: unknown, ...args: unknown[]) {
            const result = reflectApply(original, this, args);
            let write: StoredWrite | null = null;
            try {
                write = describe(this, args);
            } catch {}
            if (write) recordStored(write, wrapped);
            return result;
        },
    }[prop]!;
    proto[prop] = disguise(wrapped, original);
}

/** A cookie written through document.cookie; one set to expire right away is a deletion and isn't recorded. */
function recordCookie(text: string, hook: Function) {
    const [pair = '', ...attributes] = text.split(';');
    const at = pair.indexOf('=');
    let maxAge: number | null = null;
    let expires: number | null = null;
    for (const attribute of attributes) {
        const equals = attribute.indexOf('=');
        const name = (equals >= 0 ? attribute.slice(0, equals) : attribute).trim().toLowerCase();
        const value = equals >= 0 ? attribute.slice(equals + 1).trim() : '';
        if (name === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
        else if (name === 'expires' && !Number.isNaN(Date.parse(value))) expires = Date.parse(value);
    }
    // Max-Age wins over Expires.
    if (maxAge !== null) expires = Date.now() + maxAge * 1000;
    if (expires !== null && expires <= Date.now()) return;
    recordStored({ kind: 'cookie', name: (at >= 0 ? pair.slice(0, at) : '').trim(), value: (at >= 0 ? pair.slice(at + 1) : pair).trim(), expires }, hook);
}

/** @param hook our wrapper that was called; stack frames from it inward are skipped */
function recordStored(write: StoredWrite, hook: Function) {
    const caller = getCallerLocation(hook);
    pendingStored.push({
        ...write,
        value: write.value === null ? null : write.value.slice(0, STORED_VALUE_MAX),
        timeStamp: Date.now(),
        scriptUrl: caller?.url ?? null,
        line: caller?.line ?? null,
        column: caller?.column ?? null,
    });
    scheduleFlush();
}
