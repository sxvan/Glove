<script lang="ts">
    import { LIKELIHOOD_LABELS, type Likelihood } from '../model';

    let { likelihood }: { likelihood: Likelihood } = $props();
</script>

<span class="label tone-{likelihood}">{LIKELIHOOD_LABELS[likelihood]}</span>

<style>
    .label {
        color: var(--color);
        font-weight: 600;
        white-space: nowrap;
    }
</style>
