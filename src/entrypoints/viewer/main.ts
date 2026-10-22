import { mount } from 'svelte';
import { applyStoredTheme } from '@/lib/theme';
import App from './App.svelte';
import '@fontsource-variable/inter';
import '@/assets/theme.css';
import './code.css';

// Before the page draws itself, so it doesn't show in the other palette first.
applyStoredTheme();
mount(App, { target: document.getElementById('app')! });
