<script lang="ts">
    // Leads to another screen: a grey chevron pointing on, like a list row's, in the text color on
    // hover. The button around it is larger than the chevron, so it is easy to hit. Used by an info
    // line (see SignalLine), and by lines that lead to the same section together (see FingerprintCard).
    let { onclick }: { onclick?: () => void } = $props();
</script>

<button type="button" class="open" aria-label="Details" title="Details" {onclick}></button>

<style>
    /* In the middle of what it stands beside, detail lines included. */
    .open {
        align-self: center;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        cursor: pointer;
    }

    .open::after {
        content: '';
        width: 6px;
        height: 6px;
        margin-left: -2px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        transform: rotate(-45deg);
    }

    .open:hover {
        color: var(--text);
    }
</style>
