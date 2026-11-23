import { describe, expect, test } from 'bun:test';

import { createApp } from '../src/app';
import { clearCache, tryGet } from '../src/cache';
import { getEnv, parseConfigHeader, runWithEnv } from '../src/context';
import { toJsonFeed } from '../src/feed';
import { request } from '../src/http';
import { toItem } from '../src/platforms/twitter';
import { parseRelativeDate } from '../src/time';

describe('config header', () => {
    test('accepts credentials and a proxy', () => {
        expect(parseConfigHeader('{"TWITTER_AUTH_TOKEN":"t","PROXY_URI":"socks5h://u:p@host:1080"}')).toEqual({ TWITTER_AUTH_TOKEN: 't', PROXY_URI: 'socks5h://u:p@host:1080' });
    });
    test.each([
        ['not json', 'nope'],
        ['an array', '[]'],
        ['an instance variable', '{"ACCESS_KEY":"x"}'],
        ['an unknown name', '{"CACHE_TTL":"1"}'],
        ['an empty value', '{"TWITTER_AUTH_TOKEN":""}'],
        ['a non string', '{"TWITTER_AUTH_TOKEN":1}'],
        ['a proxy that is not a url', '{"PROXY_URI":"not a url"}'],
        ['a proxy with an unsupported protocol', '{"PROXY_URI":"ftp://h:1"}'],
        ['a header that is too large', JSON.stringify({ TWITTER_AUTH_TOKEN: 'x'.repeat(9000) })],
    ])('rejects %s', (_name, header) => {
        expect(() => parseConfigHeader(header)).toThrow();
    });
    test('accepts the YouTube OAuth and Twitter app credentials', () => {
        const env = { YOUTUBE_CLIENT_ID: 'a', YOUTUBE_CLIENT_SECRET: 'b', YOUTUBE_REFRESH_TOKEN: 'c', TWITTER_CONSUMER_KEY: 'd', TWITTER_CONSUMER_SECRET: 'e' };
        expect(parseConfigHeader(JSON.stringify(env))).toEqual(env);
    });
    test('the request value wins over the process environment', () => {
        process.env.INSTAGRAM_COOKIE = 'from-env';
        expect(getEnv('INSTAGRAM_COOKIE')).toBe('from-env');
        expect(runWithEnv({ INSTAGRAM_COOKIE: 'from-request' }, () => getEnv('INSTAGRAM_COOKIE'))).toBe('from-request');
        delete process.env.INSTAGRAM_COOKIE;
    });
});

describe('cache', () => {
    test('is never shared between credentials', async () => {
        clearCache();
        let calls = 0;
        const load = async () => ++calls;
        const a1 = await runWithEnv({ TWITTER_AUTH_TOKEN: 'a' }, () => tryGet('k', load));
        const a2 = await runWithEnv({ TWITTER_AUTH_TOKEN: 'a' }, () => tryGet('k', load));
        const b = await runWithEnv({ TWITTER_AUTH_TOKEN: 'b' }, () => tryGet('k', load));
        const none = await runWithEnv({}, () => tryGet('k', load));
        expect([a1, a2, b, none]).toEqual([1, 1, 2, 3]);
    });
    test('concurrent callers share one load', async () => {
        clearCache();
        let calls = 0;
        const load = async () => {
            await Bun.sleep(10);
            return ++calls;
        };
        expect(await Promise.all([tryGet('x', load), tryGet('x', load)])).toEqual([1, 1]);
    });
    test('expires', async () => {
        clearCache();
        let calls = 0;
        await tryGet('e', async () => ++calls, 0);
        await tryGet('e', async () => ++calls, 0);
        expect(calls).toBe(2);
    });
});

describe('proxy', () => {
    test('a request goes through the proxy of the running request only', async () => {
        const seen: string[] = [];
        const spy = Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: {
                data(socket, data) {
                    seen.push(Buffer.from(data).toString().split('\r\n')[0]);
                    socket.write('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n');
                    socket.end();
                },
            },
        });
        const proxyUri = `http://127.0.0.1:${spy.port}`;
        const viaProxy = await runWithEnv({ PROXY_URI: proxyUri }, () => request('http://example.invalid/', { retries: 0 }));
        expect(viaProxy.status).toBe(502);
        expect(seen[0]).toContain('example.invalid');
        seen.length = 0;
        await request('http://127.0.0.1:1/', { retries: 0 }).catch(() => {});
        expect(seen).toHaveLength(0);
        spy.stop(true);
    });
});

describe('app', () => {
    const app = createApp('secret');
    test('healthz is open, everything else needs the key', async () => {
        expect((await app.request('/healthz')).status).toBe(200);
        expect((await app.request('/youtube/channel/x')).status).toBe(401);
        expect((await app.request('/youtube/channel/x', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    });
    test('a bad header is a 400', async () => {
        const response = await app.request('/youtube/channel/x', { headers: { authorization: 'Bearer secret', 'x-gate-config': '{"ACCESS_KEY":"x"}' } });
        expect(response.status).toBe(400);
        expect(((await response.json()) as any).error.message).toContain('cannot be set per request');
    });
    test('an unknown route is a 404 and a bad channel id a 400', async () => {
        expect((await app.request('/nope', { headers: { authorization: 'Bearer secret' } })).status).toBe(404);
        expect((await app.request('/youtube/channel/not-an-id', { headers: { authorization: 'Bearer secret' } })).status).toBe(400);
    });
    test('twitter without a token is a 503 that names the credential', async () => {
        const response = await app.request('/twitter/user/jack', { headers: { authorization: 'Bearer secret' } });
        expect(response.status).toBe(503);
        expect(((await response.json()) as any).error.message).toContain('TWITTER_AUTH_TOKEN');
    });
});

describe('routes', () => {
    const app = createApp('secret');
    const get = (path: string) => app.request(path, { headers: { authorization: 'Bearer secret' } });
    const message = async (response: Response) => ((await response.json()) as any).error.message as string;

    // Routes that need a credential answer 503 and name it, so a 404 means the route is missing
    test.each([
        ['/twitter/media/jack', 'TWITTER_AUTH_TOKEN'],
        ['/twitter/likes/jack', 'TWITTER_AUTH_TOKEN'],
        ['/twitter/home', 'TWITTER_AUTH_TOKEN'],
        ['/twitter/home_latest', 'TWITTER_AUTH_TOKEN'],
        ['/twitter/spaces/jack', 'TWITTER_AUTH_TOKEN'],
        ['/twitter/tweet/jack/status/20', 'TWITTER_AUTH_TOKEN'],
        ['/twitter/trends', 'TWITTER_CONSUMER_KEY'],
        ['/twitter/trends/23424856', 'TWITTER_CONSUMER_KEY'],
        ['/instagram/stories/nasa', 'INSTAGRAM_COOKIE'],
        ['/instagram/highlights/nasa', 'INSTAGRAM_COOKIE'],
        ['/instagram/tags/cats', 'INSTAGRAM_COOKIE'],
        ['/youtube/subscriptions', 'YOUTUBE_CLIENT_ID'],
    ])('%s without a credential is a 503 naming %s', async (path, name) => {
        const response = await get(path);
        expect(response.status).toBe(503);
        expect(await message(response)).toContain(name);
    });

    test.each([
        ['/youtube/charts/Nope', 400],
        ['/youtube/charts/TopSongs/xyz', 400],
        ['/threads/search/rss?serpType=bad', 400],
        ['/tiktok/live/bad%20name', 400],
        ['/facebook/group/bad%20id', 404],
        ['/facebook/photos/bad%20id', 404],
        ['/facebook/reels/bad%20id', 404],
    ])('%s answers %d before any request to the platform', async (path, status) => {
        expect((await get(path)).status).toBe(status);
    });

    test('a trends woeid must be a number', async () => {
        process.env.TWITTER_CONSUMER_KEY = 'k';
        process.env.TWITTER_CONSUMER_SECRET = 's';
        const response = await get('/twitter/trends/abc');
        delete process.env.TWITTER_CONSUMER_KEY;
        delete process.env.TWITTER_CONSUMER_SECRET;
        expect(response.status).toBe(400);
    });
});

describe('feed', () => {
    test('renders JSON Feed 1.1 and applies the limit', () => {
        const feed = toJsonFeed({ title: 't', url: 'https://e.com', items: [1, 2, 3].map((n) => ({ url: `https://e.com/${n}`, title: `i${n}`, contentHtml: '<p>x</p>', published: new Date('2026-01-01T00:00:00Z'), author: 'a' })) }, 2);
        expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
        expect(feed.items).toHaveLength(2);
        expect(feed.items[0]).toMatchObject({ id: 'https://e.com/1', date_published: '2026-01-01T00:00:00.000Z', authors: [{ name: 'a' }] });
    });
});

describe('time', () => {
    test('relative dates', () => {
        const now = Date.parse('2026-01-10T00:00:00Z');
        expect(parseRelativeDate('3 days ago', now)?.toISOString()).toBe('2026-01-07T00:00:00.000Z');
        expect(parseRelativeDate('an hour ago', now)?.toISOString()).toBe('2026-01-09T23:00:00.000Z');
        expect(parseRelativeDate('Streamed 2 weeks ago', now)?.toISOString()).toBe('2025-12-27T00:00:00.000Z');
        expect(parseRelativeDate('soon', now)).toBeUndefined();
    });
});

describe('twitter rendering', () => {
    const user = { name: 'Ann', screen_name: 'ann' };
    test('a plain tweet', () => {
        const item = toItem({
            id_str: '1',
            user,
            full_text: 'hello #rss https://t.co/x\nline',
            created_at: 'Wed Oct 10 20:19:24 +0000 2018',
            entities: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://example.com' }], hashtags: [{ text: 'rss' }] },
        });
        expect(item.url).toBe('https://x.com/ann/status/1');
        expect(item.title).toBe('hello #rss https://example.com line');
        expect(item.published?.toISOString()).toBe('2018-10-10T20:19:24.000Z');
        expect(item.tags).toEqual(['rss']);
    });
    test('a retweet with a quote and a photo', () => {
        const inner = { id_str: '2', user: { name: 'Bob', screen_name: 'bob' }, full_text: 'orig', entities: {}, extended_entities: { media: [{ type: 'photo', url: 'https://t.co/p', media_url_https: 'https://pbs.twimg.com/media/abc.jpg' }] } };
        const item = toItem({ id_str: '3', user, full_text: 'RT @bob: orig', entities: {}, retweeted_status: { ...inner, is_quote_status: true, quoted_status: { id_str: '4', user: { name: 'Cy', screen_name: 'cy' }, full_text: 'quoted', entities: {} } } });
        expect(item.title).toBe('RT Bob: orig');
        expect(item.contentHtml).toContain('abc?format=jpg&name=orig');
        expect(item.contentHtml).toContain('Cy:&ensp;quoted');
    });
});
