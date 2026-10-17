import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource-variable/inter';
import '@/assets/theme.css';
import './settings.css';

mount(App, { target: document.getElementById('app')! });
