<script lang="ts">
    import { LIKELIHOOD_LABELS, type Likelihood } from '../model';

    let { likelihood }: { likelihood: Likelihood } = $props();
</script>

<span class="label tone-{likelihood}">{LIKELIHOOD_LABELS[likelihood]}</span>

<style>
    /* The size of a card's info lines. */
    .label {
        color: var(--color);
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
    }
</style>
