// The extension pages' appearance: the system's, light or dark, chosen on the options page. Kept in
// localStorage, shared by all the extension's pages (one origin), so a page can apply it before it
// draws itself, and an open page follows a change made in another (its storage event).

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

/** The chosen appearance; the system's if none was chosen or storage can't be read. */
export function storedTheme(): Theme {
    try {
        const value = localStorage.getItem(KEY);
        return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
        return 'system';
    }
}

/** Shows the page in `theme`: theme.css picks the palette from the root's data-theme. */
function apply(theme: Theme) {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
}

/** Applies the chosen appearance now, and again whenever another page changes it. */
export function applyStoredTheme() {
    apply(storedTheme());
    window.addEventListener('storage', (event) => {
        if (event.key === KEY) apply(storedTheme());
    });
}

/** Chooses an appearance for all the extension's pages. */
export function setTheme(theme: Theme) {
    try {
        if (theme === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, theme);
    } catch {}
    apply(theme);
}
