import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { badRequest } from './errors';

/** Credentials and proxy a request may bring itself, in the X-Gate-Config header (X-Rssgate-Config and X-Postgate-Config are accepted too). */
export const allowedNames = ['TWITTER_AUTH_TOKEN', 'TWITTER_COOKIE', 'TWITTER_CONSUMER_KEY', 'TWITTER_CONSUMER_SECRET', 'INSTAGRAM_COOKIE', 'FACEBOOK_COOKIE', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'PROXY_URI'] as const;
type Name = (typeof allowedNames)[number];

type Store = { env: Partial<Record<Name, string>>; scope: string; session: Partial<Record<Name, string>> };
const storage = new AsyncLocalStorage<Store>();

const maxHeaderLength = 8192;
const proxyProtocols = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);
const headerName = 'X-Gate-Config';
export const configHeaderNames = ['x-gate-config', 'x-rssgate-config', 'x-postgate-config'] as const;

export const parseConfigHeader = (header: string): Store['env'] => {
    if (header.length > maxHeaderLength) {
        throw badRequest(`${headerName} is too large.`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(header);
    } catch {
        throw badRequest(`${headerName} must be valid JSON.`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw badRequest(`${headerName} must be a JSON object such as {"TWITTER_AUTH_TOKEN":"..."}.`);
    }
    const env: Store['env'] = {};
    for (const [name, value] of Object.entries(parsed)) {
        if (!(allowedNames as readonly string[]).includes(name)) {
            throw badRequest(`${headerName}: "${name}" cannot be set per request, expected one of ${allowedNames.join(', ')}.`);
        }
        if (typeof value !== 'string' || value === '') {
            throw badRequest(`${headerName}: "${name}" must be a non-empty string.`);
        }
        env[name as Name] = value;
    }
    if (env.PROXY_URI) {
        let url: URL;
        try {
            url = new URL(env.PROXY_URI);
        } catch {
            throw badRequest(`${headerName}: "PROXY_URI" must be a URL such as socks5h://user:pass@host:1080.`);
        }
        if (!proxyProtocols.has(url.protocol)) {
            throw badRequest(`${headerName}: "PROXY_URI" must use one of http, https, socks5, socks5h.`);
        }
    }
    return env;
};

const scopeOf = (env: Store['env']) =>
    Object.keys(env).length === 0
        ? ''
        : createHash('sha256')
              .update(JSON.stringify(Object.entries(env).toSorted(([a], [b]) => (a < b ? -1 : 1))))
              .digest('hex')
              .slice(0, 16);

export const runWithEnv = <T>(env: Store['env'], fn: () => T): T => storage.run({ env, scope: scopeOf(env), session: {} }, fn);

/** The value the request brought, else the one of the process environment. */
export const getEnv = (name: Name): string | undefined => storage.getStore()?.env[name] || process.env[name] || undefined;

/** Identifies the credentials of the running request, so cached data is never shared between credentials. */
export const getScope = (): string => storage.getStore()?.scope ?? '';

/** The platform changed the credential (rotated cookie, fresh jar): the caller gets it back in the X-Gate-Session header. */
export const recordSession = (update: Partial<Record<Name, string>>): void => {
    const store = storage.getStore();
    if (store) {
        Object.assign(store.session, update);
    }
};

export const getSessionUpdates = (): Partial<Record<Name, string>> => storage.getStore()?.session ?? {};
