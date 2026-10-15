// The browser-only formatter inside js-beautify, without its command-line dependencies.
declare module 'js-beautify/js/lib/beautify.js' {
    export function js_beautify(source: string, options?: Record<string, unknown>): string;
}
