import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource-variable/inter';
import '@/assets/theme.css';
import 'highlight.js/styles/github-dark.css';

mount(App, { target: document.getElementById('app')! });
