// Makes the recorders' wrappers of page APIs look like the browser's own functions, so a page
// checking for hooks sees none and behaves as it would without the extension. reCAPTCHA, for one,
// turns the window.innerHeight getter into source text and, finding a wrapper there instead of
// "[native code]", skips reading the screen. A wrapper takes over its original's name and length,
// has no prototype and can't be called with new (made with method syntax, see the recorders), and
// Function.prototype.toString shows the original's source for it, also for the patched toString
// itself. Not covered: a wrapper's frame in the stack trace of an error thrown through it.
//
// Each recorder is its own bundle with its own copy of this module; the second one's toString wraps
// the first one's, which passes on what isn't its own, so they chain.

// Captured when the module runs, before page scripts, so replaced globals can't see or break it.
const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const weakMapGet = WeakMap.prototype.get;
const weakMapHas = WeakMap.prototype.has;
const weakMapSet = WeakMap.prototype.set;

/** The original each of our wrappers stands in for. */
const originals = new WeakMap<object, Function>();
let installed = false;

/** Patches Function.prototype.toString to show the originals' source for our wrappers. Once per recorder, before page scripts run. */
export function installDisguise() {
    if (installed) return;
    installed = true;

    const descriptor = getOwnPropertyDescriptor(Function.prototype, 'toString');
    const previous: unknown = descriptor?.value;
    if (!descriptor || typeof previous !== 'function') return;

    const toString = {
        toString(this: unknown) {
            // WeakMap.get returns undefined for anything that isn't ours, primitives included;
            // the previous toString then throws for non-functions just as the native one does.
            const original: Function | undefined = apply(weakMapGet, originals, [this]);
            return apply(previous, original ?? this, []);
        },
    }.toString;
    disguise(toString, previous);
    defineProperty(Function.prototype, 'toString', { ...descriptor, value: toString });
}

/** Makes `wrapper` look like `original`: its name, its length and its source text. */
export function disguise<T extends Function>(wrapper: T, original: Function): T {
    for (const key of ['name', 'length']) {
        const descriptor = getOwnPropertyDescriptor(original, key);
        if (descriptor) defineProperty(wrapper, key, descriptor);
    }
    apply(weakMapSet, originals, [wrapper, original]);
    return wrapper;
}

/** Whether `fn` is one of this recorder's wrappers, so an API isn't wrapped twice. */
export function isDisguised(fn: unknown): boolean {
    return apply(weakMapHas, originals, [fn]);
}
