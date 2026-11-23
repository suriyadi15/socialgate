import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { tryGet } from './cache';
import { configHeaderNames, getSessionUpdates, parseConfigHeader, runWithEnv } from './context';
import { badRequest, HttpError } from './errors';
import { toJsonFeed } from './feed';
import { actions } from './routes/session';
import { facebook } from './routes/facebook';
import { instagram } from './routes/instagram';
import { threads } from './routes/threads';
import { tiktok } from './routes/tiktok';
import { twitter } from './routes/twitter';
import type { Routes } from './routes/types';
import { youtube } from './routes/youtube';

const feedTtl = Number(process.env.CACHE_TTL ?? 300);
const maxLimit = 100;

const sameKey = (given: string, expected: string) => {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
};

export const createApp = (accessKey: string) => {
    const app = new Hono();

    app.get('/healthz', (c) => c.text('ok'));

    app.use('*', async (c, next) => {
        const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
        const given = bearer ?? c.req.query('key') ?? '';
        if (!sameKey(given, accessKey)) {
            throw new HttpError(401, 'Access denied, send the access key as "Authorization: Bearer <key>".');
        }
        const header = configHeaderNames.map((name) => c.req.header(name)).find((value) => value !== undefined);
        await runWithEnv(header === undefined ? {} : parseConfigHeader(header), async () => {
            await next();
            // The platform changed the credential during this request: the caller stores it
            const updates = getSessionUpdates();
            if (Object.keys(updates).length > 0) {
                c.res.headers.set('X-Gate-Session', JSON.stringify(updates));
            }
        });
    });

    app.use(
        '*',
        bodyLimit({
            maxSize: 32 * 1024 * 1024,
            onError: () => {
                throw new HttpError(413, 'The body is too large.');
            },
        })
    );

    for (const [namespace, routes] of Object.entries(actions)) {
        for (const [path, methods] of Object.entries(routes)) {
            for (const [method, handler] of Object.entries(methods)) {
                app.on(method, `/${namespace}${path}`, async (c) => {
                    let body: unknown;
                    if (method === 'POST') {
                        try {
                            body = await c.req.json();
                        } catch {
                            throw badRequest('The body must be valid JSON.');
                        }
                    }
                    const result = await handler!({ params: c.req.param() as Record<string, string>, body });
                    c.header('Cache-Control', 'no-store');
                    return c.json(result);
                });
            }
        }
    }

    const groups: Record<string, Routes> = { twitter, instagram, threads, facebook, tiktok, youtube };
    for (const [namespace, routes] of Object.entries(groups)) {
        for (const [path, handler] of Object.entries(routes)) {
            app.get(`/${namespace}${path}`, async (c) => {
                const limitText = c.req.query('limit');
                const limit = limitText ? Math.min(Math.max(Number.parseInt(limitText, 10) || 0, 1), maxLimit) : undefined;
                const params = c.req.param() as Record<string, string>;
                const noCache = c.req.header('cache-control')?.includes('no-cache');
                const query = c.req.query();
                const feed = await (noCache ? handler(params, query) : tryGet(`feed:${c.req.path}?${new URLSearchParams(query)}`, () => handler(params, query), feedTtl));
                c.header('Cache-Control', 'no-store');
                return c.json(toJsonFeed(feed, limit));
            });
        }
    }

    app.notFound((c) => c.json({ error: { message: `No route ${c.req.path}` } }, 404));
    app.onError((error, c) => {
        if (error instanceof HttpError) {
            return c.json({ error: { message: error.message } }, error.status);
        }
        console.error(`Unhandled error on ${c.req.path}: ${error.stack ?? error}`);
        return c.json({ error: { message: 'Internal error' } }, 500);
    });

    return app;
};
