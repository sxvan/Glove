<script lang="ts">
    // Larger than its chevron, so it is easy to hit.
    let { onclick }: { onclick?: () => void } = $props();
</script>

<button type="button" class="open" aria-label="Details" title="Details" {onclick}></button>

<style>
    .open {
        align-self: center;
        display: grid;
        place-items: center;
        width: var(--chevron-button);
        height: var(--chevron-button);
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
