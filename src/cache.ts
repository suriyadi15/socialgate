import { getScope } from './context';

type Entry = { value: unknown; expires: number };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const maxEntries = 1000;

export const defaultTtl = Number(process.env.CONTENT_TTL ?? 3600);

const scoped = (key: string) => `${getScope()}|${key}`;

/**
 * Returns the cached value of `key`, else runs `load` once (concurrent callers share it) and keeps the result for `ttl` seconds.
 * Keys are bound to the credentials of the running request.
 */
export const tryGet = async <T>(key: string, load: () => Promise<T>, ttl = defaultTtl): Promise<T> => {
    const k = scoped(key);
    const hit = entries.get(k);
    if (hit && hit.expires > Date.now()) {
        return hit.value as T;
    }
    const pending = inflight.get(k);
    if (pending) {
        return pending as Promise<T>;
    }
    const promise = load()
        .then((value) => {
            if (entries.size >= maxEntries) {
                entries.delete(entries.keys().next().value!);
            }
            entries.set(k, { value, expires: Date.now() + ttl * 1000 });
            return value;
        })
        .finally(() => inflight.delete(k));
    inflight.set(k, promise);
    return promise;
};

export const clearCache = () => {
    entries.clear();
    inflight.clear();
};

/** Replaces a cached value (e.g. a cookie jar the platform just renewed). Keys are bound to the credentials of the request. */
export const putCache = (key: string, value: unknown, ttl = defaultTtl): void => {
    entries.set(scoped(key), { value, expires: Date.now() + ttl * 1000 });
};
