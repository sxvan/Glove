<script module lang="ts">
    let context: CanvasRenderingContext2D | null = null;
    function measure(text: string, font: string): number {
        context ??= document.createElement('canvas').getContext('2d');
        if (!context) return 0;
        context.font = font;
        return context.measureText(text).width;
    }

    // Re-measures once the bundled font has loaded, as it is wider than the fallback.
    let fontsLoaded = $state(false);
    if (typeof document !== 'undefined') document.fonts?.ready.then(() => (fontsLoaded = true));
</script>

<script lang="ts">
    // Shortened in the middle, keeping its end: a path its file name ("/d6u0JtnNFN/8-uXtx…/OCw"), with
    // its parameters cut first, as their values can hold URLs; anything else its last `tail`
    // characters. CSS has no ellipsis in the middle, and two boxes would leave a gap after it.
    let { text, path = false, tail = 12, plain = false }: { text: string; path?: boolean; tail?: number; plain?: boolean } = $props();

    let box = $state<HTMLElement>();
    let width = $state(0);

    function paramsAt(text: string): number {
        const at = text.search(/[?;]/);
        return at >= 0 ? at : text.length;
    }

    function endOf(text: string): string {
        if (path) {
            const lastSlash = text.lastIndexOf('/');
            // A file at the root ("/launch-….min.js") is all file name, its slash at index 0.
            return lastSlash >= 0 ? text.slice(lastSlash) : '';
        }
        return text.length > tail * 2 ? text.slice(-tail) : '';
    }

    function fit(text: string, end: string, prefix: string, font: string, suffix = ''): string | null {
        const fits = (n: number) => measure(prefix + text.slice(0, n) + '…' + end + suffix, font) <= width;
        if (!fits(0)) return null;
        let low = 0;
        let high = text.length - end.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (fits(mid)) low = mid;
            else high = mid - 1;
        }
        return prefix + text.slice(0, low) + '…' + end;
    }

    const shown = $derived.by(() => {
        void fontsLoaded;
        if (!box || width <= 0) return text;
        const font = getComputedStyle(box).font;
        if (measure(text, font) <= width) return text;

        if (!path) return fit(text, endOf(text), '', font) ?? text;

        const base = text.slice(0, paramsAt(text));
        const params = text.slice(base.length);
        if (params && measure(base + '…', font) <= width) return fit(params, '', base, font) ?? text;

        const more = params ? '…' : '';
        const end = endOf(base);
        const shortened = fit(base, end, '', font, more);
        if (shortened !== null || !end) return shortened ?? text;

        const prefix = end.length < base.length ? '…' : '';
        const fileEnd = end.length > tail * 2 ? end.slice(-tail) : '';
        return fit(end, fileEnd, prefix, font, more) ?? prefix + end + more;
    });

    // The file name never contains a slash, also when shortened.
    const paramsStart = $derived(path ? paramsAt(shown) : shown.length);
    const folders = $derived(path ? shown.slice(0, shown.lastIndexOf('/', paramsStart - 1) + 1) : '');
    const file = $derived(shown.slice(folders.length, paramsStart));
    const params = $derived(shown.slice(paramsStart));
</script>

<!-- A path's folders and parameters are toned down, so the file name stands out. -->
<span class="truncate" bind:this={box} bind:clientWidth={width}
    >{#if path && folders}<span class="folders" class:plain>{folders}</span>{/if}{file}{#if params}<span class="folders" class:plain>{params}</span>{/if}</span
>

<style>
    .truncate {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .folders {
        color: var(--muted);
    }

    .folders.plain {
        color: inherit;
    }
</style>
