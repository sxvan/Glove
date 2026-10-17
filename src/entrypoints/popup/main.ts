import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource-variable/inter';
import '@/assets/theme.css';
import './app.css';

mount(App, { target: document.getElementById('app')! });
