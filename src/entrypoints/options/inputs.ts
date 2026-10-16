// Reading the numbers typed into the options page's inputs; null while the input isn't a number.

/** A percentage, as a value from 0 to 1. */
export function percentFromInput(event: Event): number | null {
    const value = valueOf(event);
    return value === null ? null : Math.min(100, Math.max(0, value)) / 100;
}

/** A positive number, without an upper limit. */
export function positiveFromInput(event: Event): number | null {
    const value = valueOf(event);
    return value === null ? null : Math.max(0, value);
}

/** A value from 0 to 1. */
export function unitFromInput(event: Event): number | null {
    const value = valueOf(event);
    return value === null ? null : Math.min(1, Math.max(0, value));
}

export const percent = (value: number) => Math.round(value * 100);

function valueOf(event: Event): number | null {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(value) ? value : null;
}
