type Task = () => void;

interface ScheduleState {
    lastNotify: number;
    lastRun: number;
    timerId: ReturnType<typeof setTimeout> | null;
}

export interface Scheduler {
    notify(key: string, taskFn: Task): void;
    cancel(key: string): void;
    clearAll(): void;
}

export function createScheduler({ debounceMs = 500, maxIntervalMs = 5000 } = {}): Scheduler {
    const states = new Map<string, ScheduleState>();

    function notify(key: string, taskFn: Task) {
        const now = Date.now();
        let state = states.get(key);
        if (!state) {
            state = { lastNotify: 0, lastRun: 0, timerId: null };
            states.set(key, state);
        }

        state.lastNotify = now;
        schedule(key, taskFn, state);
    }

    function schedule(key: string, taskFn: Task, state: ScheduleState) {
        const now = Date.now();

        if (state.timerId) {
            return; // already scheduled
        }

        // first time: simple debounce
        if (!state.lastRun) {
            plan(key, taskFn, state, debounceMs);
            return;
        }

        const sinceLastRun = now - state.lastRun;
        const sinceLastNotify = now - state.lastNotify;

        const debounceDelay = Math.max(debounceMs, debounceMs - sinceLastNotify);
        const remainingUntilMax = maxIntervalMs - sinceLastRun;
        const finalDelay = Math.min(debounceDelay, remainingUntilMax);

        plan(key, taskFn, state, finalDelay);
    }

    function plan(key: string, analyzeFn: Task, state: ScheduleState, delay: number) {
        state.timerId = setTimeout(() => {
            state.timerId = null;
            maybeRun(key, analyzeFn, state);
        }, delay);
    }

    function maybeRun(key: string, analyzeFn: Task, state: ScheduleState) {
        const now = Date.now();
        const idleLongEnough = now - state.lastNotify >= debounceMs;
        const maxIntervalExceeded = now - state.lastRun >= maxIntervalMs;

        if (!idleLongEnough && !maxIntervalExceeded) {
            // still active, reschedule
            schedule(key, analyzeFn, state);
            return;
        }

        state.lastRun = now;
        analyzeFn();
    }

    function cancel(key: string) {
        const state = states.get(key);
        if (!state) return;
        if (state.timerId) {
            clearTimeout(state.timerId);
        }
        states.delete(key);
    }

    function clearAll() {
        for (const [key, state] of states) {
            if (state.timerId) {
                clearTimeout(state.timerId);
            }
        }
        states.clear();
    }

    return { notify, cancel, clearAll };
}
