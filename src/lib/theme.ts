// In localStorage, shared by the extension's pages (one origin), so a page applies it before it draws
// itself and follows a change made in another (the storage event).

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

export function storedTheme(): Theme {
    try {
        const value = localStorage.getItem(KEY);
        return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
        return 'system';
    }
}

// theme.css picks the palette from the root's data-theme.
function apply(theme: Theme) {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
}

export function applyStoredTheme() {
    apply(storedTheme());
    window.addEventListener('storage', (event) => {
        if (event.key === KEY) apply(storedTheme());
    });
}

export function setTheme(theme: Theme) {
    try {
        if (theme === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, theme);
    } catch {}
    apply(theme);
}
