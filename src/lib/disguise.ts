// Makes the recorders' wrappers look like the browser's own functions, so a page checking for hooks
// behaves as without the extension: reCAPTCHA turns the innerHeight getter into source text and,
// finding no "[native code]", skips reading the screen. Not covered: a wrapper's frame in the stack
// trace of an error thrown through it.
// Each recorder bundles its own copy; the second one's toString wraps the first one's, so they chain.

// Captured when the module runs, before page scripts, so replaced globals can't see or break it.
const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const weakMapGet = WeakMap.prototype.get;
const weakMapHas = WeakMap.prototype.has;
const weakMapSet = WeakMap.prototype.set;

const originals = new WeakMap<object, Function>();
let installed = false;

// Once per recorder, before page scripts run.
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

export function disguise<T extends Function>(wrapper: T, original: Function): T {
    for (const key of ['name', 'length']) {
        const descriptor = getOwnPropertyDescriptor(original, key);
        if (descriptor) defineProperty(wrapper, key, descriptor);
    }
    apply(weakMapSet, originals, [wrapper, original]);
    return wrapper;
}

// So an API isn't wrapped twice.
export function isDisguised(fn: unknown): boolean {
    return apply(weakMapHas, originals, [fn]);
}
