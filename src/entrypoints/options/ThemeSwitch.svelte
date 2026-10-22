<script lang="ts">
    import { setTheme, storedTheme, type Theme } from '@/lib/theme';

    const THEMES: { theme: Theme; label: string }[] = [
        { theme: 'system', label: 'System' },
        { theme: 'light', label: 'Light' },
        { theme: 'dark', label: 'Dark' },
    ];
    let { theme = $bindable(storedTheme()) }: { theme?: Theme } = $props();

    function choose(next: Theme) {
        theme = next;
        setTheme(next);
    }
</script>

<div class="segments segmented" role="radiogroup" aria-label="Appearance">
    {#each THEMES as option (option.theme)}
        <button type="button" role="radio" aria-checked={theme === option.theme} onclick={() => choose(option.theme)}>
            {option.label}
        </button>
    {/each}
</div>

<style>
    /* On the page's background, as it sits on a section. */
    .segments {
        display: inline-grid;
        grid-auto-columns: 1fr;
        grid-auto-flow: column;
        background: var(--bg);
    }

    .segments > button {
        padding: 5px 14px;
        font-size: 14px;
    }
</style>
