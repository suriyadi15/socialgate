import { afterEach, describe, expect, test } from 'bun:test';

import { createApp } from '../src/app';
import { clearCache } from '../src/cache';
import { getSessionUpdates, parseConfigHeader, recordSession, runWithEnv } from '../src/context';
import { HttpError } from '../src/errors';
import { buildCreateTweetVariables, categoryOf, checkMedia, chunks, mapGraphqlError, tweetIdOf } from '../src/platforms/twitter-post';
import { cookieString, parseJar, renewCsrf } from '../src/platforms/twitter';

const app = createApp('k');
const auth = { authorization: 'Bearer k' };

afterEach(clearCache);

describe('write routes', () => {
    test('401 without the key', async () => {
        expect((await app.request('/twitter/me')).status).toBe(401);
    });
    test('503 without a credential', async () => {
        expect((await app.request('/twitter/me', { headers: auth })).status).toBe(503);
        expect((await app.request('/twitter/session', { headers: auth })).status).toBe(503);
    });
    test('400 on a body that is not JSON', async () => {
        const response = await app.request('/twitter/tweet', { method: 'POST', headers: { ...auth, 'x-gate-config': '{"TWITTER_AUTH_TOKEN":"t"}' }, body: 'x' });
        expect(response.status).toBe(400);
    });
    test('400 on an empty tweet', async () => {
        const response = await app.request('/twitter/tweet', { method: 'POST', headers: { ...auth, 'x-gate-config': '{"TWITTER_AUTH_TOKEN":"t"}' }, body: '{"text":" "}' });
        expect(response.status).toBe(400);
    });
    test('the old header names still work', async () => {
        for (const name of ['x-rssgate-config', 'x-postgate-config']) {
            const response = await app.request('/twitter/tweet', { method: 'POST', headers: { ...auth, [name]: '{"TWITTER_AUTH_TOKEN":"t"}' }, body: '{"text":" "}' });
            expect(response.status).toBe(400); // the credential was read: the empty tweet is what fails
        }
    });
    test('session routes exist for every platform that has accounts', async () => {
        for (const platform of ['instagram', 'facebook']) {
            expect((await app.request(`/${platform}/session`, { headers: auth })).status).toBe(503);
        }
    });
});

describe('session', () => {
    test('TWITTER_COOKIE is an accepted credential', () => {
        expect(parseConfigHeader('{"TWITTER_COOKIE":"auth_token=a; ct0=b"}')).toEqual({ TWITTER_COOKIE: 'auth_token=a; ct0=b' });
    });
    test('cookie jar round trip', () => {
        const jar = parseJar('auth_token=a; ct0=b=c; guest_id=1');
        expect(jar).toEqual({ auth_token: 'a', ct0: 'b=c', guest_id: '1' });
        expect(cookieString(jar)).toBe('auth_token=a; ct0=b=c; guest_id=1');
    });
    test('changes of the credential are collected per request', () => {
        runWithEnv({}, () => {
            expect(getSessionUpdates()).toEqual({});
            recordSession({ TWITTER_COOKIE: 'auth_token=a; ct0=new' });
            expect(getSessionUpdates()).toEqual({ TWITTER_COOKIE: 'auth_token=a; ct0=new' });
        });
        runWithEnv({}, () => expect(getSessionUpdates()).toEqual({}));
    });
});

describe('tweet variables', () => {
    test('plain text', () => {
        expect(buildCreateTweetVariables({ text: 'hi' })).toEqual({ tweet_text: 'hi', dark_request: false, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [] });
    });
    test('reply, quote, media and sensitive', () => {
        const v = buildCreateTweetVariables({ text: 'hi', replyTo: 'https://x.com/jack/status/20', quoteUrl: 'https://x.com/a/status/1', sensitive: true }, ['111', '222']);
        expect(v.reply).toEqual({ in_reply_to_tweet_id: '20', exclude_reply_user_ids: [] });
        expect(v.attachment_url).toBe('https://x.com/a/status/1');
        expect(v.media).toEqual({ media_entities: [{ media_id: '111', tagged_users: [] }, { media_id: '222', tagged_users: [] }], possibly_sensitive: true });
    });
    test('tweet ids', () => {
        expect(tweetIdOf('123')).toBe('123');
        expect(tweetIdOf('https://x.com/jack/status/20?s=1')).toBe('20');
        expect(() => tweetIdOf('abc')).toThrow();
    });
});

describe('errors', () => {
    test.each([
        [187, 409],
        [186, 400],
        [185, 429],
        [226, 422],
        [326, 503],
        [999, 502],
    ])('code %i becomes %i', (code, status) => {
        const error = mapGraphqlError([{ code, message: 'm' }]);
        expect(error).toBeInstanceOf(HttpError);
        expect(error.status).toBe(status as 400);
    });
});

describe('media', () => {
    test('categories', () => {
        expect(categoryOf('image/png')).toBe('tweet_image');
        expect(categoryOf('image/gif')).toBe('tweet_gif');
        expect(categoryOf('video/mp4')).toBe('tweet_video');
        expect(() => categoryOf('text/plain')).toThrow();
    });
    test('combinations', () => {
        expect(() => checkMedia(['tweet_image', 'tweet_image', 'tweet_image', 'tweet_image'])).not.toThrow();
        expect(() => checkMedia(['tweet_image', 'tweet_image', 'tweet_image', 'tweet_image', 'tweet_image'])).toThrow();
        expect(() => checkMedia(['tweet_video', 'tweet_image'])).toThrow();
        expect(() => checkMedia(['tweet_video'])).not.toThrow();
    });
    test('chunks', () => {
        const parts = chunks(new Uint8Array(10), 4);
        expect(parts.map((p) => p.length)).toEqual([4, 4, 2]);
    });
});

describe('stale csrf', () => {
    test('a fresh ct0 in the refusal is adopted and reported once', () => {
        const refused = new Response('', { status: 403, headers: { 'set-cookie': 'ct0=newvalue; Path=/; Secure' } });
        runWithEnv({}, () => {
            const jar = renewCsrf({ auth_token: 'a', ct0: 'old' }, refused);
            expect(jar).toEqual({ auth_token: 'a', ct0: 'newvalue' });
            expect(getSessionUpdates()).toEqual({ TWITTER_COOKIE: 'auth_token=a; ct0=newvalue' });
        });
    });
    test('nothing to renew when the refusal brings no new ct0', () => {
        runWithEnv({}, () => {
            expect(renewCsrf({ auth_token: 'a', ct0: 'same' }, new Response('', { status: 403 }))).toBeUndefined();
            const same = new Response('', { status: 403, headers: { 'set-cookie': 'ct0=same; Path=/' } });
            expect(renewCsrf({ auth_token: 'a', ct0: 'same' }, same)).toBeUndefined();
            expect(getSessionUpdates()).toEqual({});
        });
    });
});
