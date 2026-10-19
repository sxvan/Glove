<script lang="ts">
    // An on/off setting as a switch, like the popup's "Block this script": a track with a knob, here in
    // the text color while on, as a setting is neither good nor bad. A checkbox underneath, so it is
    // labeled, focused and toggled like one.
    let { checked, onchange }: { checked: boolean; onchange: (checked: boolean) => void } = $props();
</script>

<input type="checkbox" role="switch" {checked} onchange={(event) => onchange(event.currentTarget.checked)} />

<style>
    input {
        position: relative;
        width: 34px;
        height: 20px;
        margin: 0;
        border-radius: 10px;
        background: color-mix(in srgb, var(--muted) 45%, var(--surface));
        cursor: pointer;
        appearance: none;
        transition: background 0.15s;
    }

    input::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px var(--shadow);
        transition:
            transform 0.15s,
            background 0.15s;
    }

    input:checked {
        background: var(--text);
    }

    /* On the text color, the knob takes the page's: dark on white in dark mode, white on dark in light. */
    input:checked::after {
        background: var(--surface);
        transform: translateX(14px);
    }

    input:focus-visible {
        outline: 2px solid var(--info);
        outline-offset: 2px;
    }
</style>
