<script lang="ts">
    // What happens right after blocking a script (see BlockingOptions), saved as soon as switched.
    import { onMount } from 'svelte';
    import { DEFAULT_BLOCKING_OPTIONS, loadBlockingOptions, saveBlockingOptions, type BlockingOptions } from '@/lib/blocking';

    let options = $state<BlockingOptions>({ ...DEFAULT_BLOCKING_OPTIONS });

    onMount(async () => {
        options = await loadBlockingOptions();
    });

    function set(key: keyof BlockingOptions, event: Event) {
        options[key] = (event.currentTarget as HTMLInputElement).checked;
        saveBlockingOptions($state.snapshot(options));
    }
</script>

<section class="squircle">
    <h2>Blocking</h2>
    <label class="row">
        <div>
            <div class="name">Reload the page</div>
            <div class="description">After blocking a script or letting it run again, load the page again, so the change takes effect at once.</div>
        </div>
        <input type="checkbox" checked={options.reload} onchange={(e) => set('reload', e)} />
    </label>
    <label class="row">
        <div>
            <div class="name">Clear the site's data</div>
            <div class="description">
                After blocking a script, clear the cookies and storage of the page's site, and of any frame's site the script ran in, then load the
                page again: the script's stored identifiers are gone too. This logs you out of the site. The page is left first, so none of its
                scripts can store again while the data is cleared.
            </div>
        </div>
        <input type="checkbox" checked={options.clearData} onchange={(e) => set('clearData', e)} />
    </label>
</section>

<style>
    /* Like the scoring settings' rows: the text, then the switch. */
    .row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 16px;
        padding: 8px 0;
        cursor: pointer;
    }

    .name {
        font-weight: 600;
    }

    .description {
        color: var(--muted);
        font-size: 13px;
    }

    input {
        width: 18px;
        height: 18px;
        accent-color: var(--info);
    }
</style>
