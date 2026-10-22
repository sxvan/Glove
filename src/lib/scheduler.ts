type Task = () => void;

interface ScheduleState {
    lastNotify: number;
    lastRun: number;
    timerId: ReturnType<typeof setTimeout> | null;
}

/**
 * Runs a key's task once the key has been quiet for `debounceMs`, and at least every
 * `maxIntervalMs` while it isn't, so a page calling APIs nonstop is still analyzed. Keyed by an
 * object, e.g. a document, so a key's state goes with it.
 */
export function createScheduler({ debounceMs = 500, maxIntervalMs = 5000 } = {}) {
    const states = new WeakMap<object, ScheduleState>();

    function notify(key: object, task: Task) {
        const state = states.get(key) ?? { lastNotify: 0, lastRun: 0, timerId: null };
        states.set(key, state);
        state.lastNotify = Date.now();
        schedule(state, task);
    }

    function schedule(state: ScheduleState, task: Task) {
        if (state.timerId) return;
        const delay = state.lastRun ? Math.min(debounceMs, maxIntervalMs - (Date.now() - state.lastRun)) : debounceMs;
        state.timerId = setTimeout(() => {
            state.timerId = null;
            run(state, task);
        }, delay);
    }

    function run(state: ScheduleState, task: Task) {
        const now = Date.now();
        if (now - state.lastNotify < debounceMs && now - state.lastRun < maxIntervalMs) {
            schedule(state, task);
            return;
        }
        state.lastRun = now;
        task();
    }

    return { notify };
}
