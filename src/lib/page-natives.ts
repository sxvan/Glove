// What the main-world recorders (fp-recorder, http-recorder) rely on, captured as they load, before
// page scripts run, so a page that replaces it can't see the hooks' calls, or delay or break them.
import type { RecorderEvents } from '@/types/events';

export const reflectApply = Reflect.apply;
const dispatchEvent = EventTarget.prototype.dispatchEvent;
const NativeCustomEvent = CustomEvent;

// Doubles as a brand check: undefined unless `target` is a genuine instance.
export function nativeGetter<T>(proto: object, prop: string): (target: unknown) => T | undefined {
    const get = Object.getOwnPropertyDescriptor(proto, prop)?.get;
    return (target) => {
        if (!get || target === null || typeof target !== 'object') return undefined;
        try {
            return reflectApply(get, target, []) as T;
        } catch {
            return undefined;
        }
    };
}

export function nativeSetters(proto: object, props: string[]): (target: unknown, values: unknown[]) => void {
    const setters = props.map((prop) => Object.getOwnPropertyDescriptor(proto, prop)?.set);
    return (target, values) => setters.forEach((set, i) => reflectApply(set!, target, [values[i]]));
}

export function handOver<K extends keyof RecorderEvents>(to: Document, name: K, detail: RecorderEvents[K]) {
    reflectApply(dispatchEvent, to.documentElement, [new NativeCustomEvent(name, { detail })]);
}
