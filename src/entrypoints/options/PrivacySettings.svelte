<script lang="ts">
    // What the extension may send off the browser (see lib/privacy), saved as soon as switched.
    import { onMount } from 'svelte';
    import { DEFAULT_PRIVACY, loadPrivacy, savePrivacy, watchPrivacy, type PrivacyOptions } from '@/lib/privacy';
    import Switch from '../popup/components/Switch.svelte';
    import SectionHead from './SectionHead.svelte';

    let options = $state<PrivacyOptions>({ ...DEFAULT_PRIVACY });

    // Also follows a reset of all settings (see App).
    onMount(() => {
        loadPrivacy().then((loaded) => (options = loaded));
        return watchPrivacy((changed) => (options = changed));
    });

    const reset = () => savePrivacy({ ...DEFAULT_PRIVACY });

    function setDnsLookups(on: boolean) {
        options.dnsLookups = on;
        savePrivacy($state.snapshot(options));
    }

    const sectionChanged = $derived(options.dnsLookups !== DEFAULT_PRIVACY.dnsLookups);

    // Whether the section differs from its defaults, for the page's "Reset all" (see App).
    let { changed = $bindable(false) }: { changed?: boolean } = $props();
    $effect(() => {
        changed = sectionChanged;
    });
</script>

<SectionHead title="Privacy" changed={sectionChanged} onreset={reset} />

<label class="row">
    <div>
        <div class="name">DNS lookups</div>
        <div class="description">
            To find CNAME cloaking, another company's tracker behind an address of the site, the page's own subdomains are looked up at Quad9
            (dns.quad9.net), a non-profit DNS resolver that doesn't store IP addresses, but learns the names asked. Off, nothing is looked up, and
            cloaking isn't detected or scored.
        </div>
    </div>
    <Switch checked={options.dnsLookups} onchange={setDnsLookups} />
    <span class="default" class:changed={sectionChanged}>default {DEFAULT_PRIVACY.dnsLookups ? 'on' : 'off'}</span>
</label>
