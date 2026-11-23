// Ported from RSSHub lib/routes/twitter/api/web-api/{api,utils,constants,gql-id-resolver,client-transaction-id}.ts and lib/routes/twitter/utils.ts
import { ClientTransaction, fetchXDocument } from 'x-client-transaction-id';

import { putCache, tryGet } from '../cache';
import { getEnv, recordSession } from '../context';
import { badRequest, HttpError, needsCredential, notFound } from '../errors';
import type { Feed, Item } from '../feed';
import { request } from '../http';

const baseUrl = 'https://x.com/i/api';
export const apiUrl = baseUrl;
export const bearerToken = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Last known working query ids, replaced by the live ones when they can be fetched
const fallbackIds: Record<string, string> = {
    UserTweets: 'eoJ5zbv51Z_KVl81v9PmLQ',
    UserByScreenName: 'Gb-d6r0vxPOADdG62OEBpQ',
    HomeTimeline: '3b9_7tltt0hJRef-xm_3sw',
    HomeLatestTimeline: 'm1G65W9TS1-g-AllrKKYDQ',
    UserTweetsAndReplies: 'wc5DRl4VaW5lSqJ8YbftZQ',
    UserMedia: '2DC9TKrcUzwGC_QskSVl5w',
    UserByRestId: 'xvmVfRLmnr1alc5f2dib0Q',
    SearchTimeline: 'BGd0T_j7oVwlW5U79tO_0A',
    ListLatestTweetsTimeline: 'jW040BLUjh8X6Tw2ODQufA',
    TweetDetail: '559hs_YZNV4IgA3Z6zIIuw',
    // Likes is not in RSSHub's list; this id is the last one seen and is replaced by the live one
    Likes: 'eSSNbhECHHWWALkkQq-YTA',
    // Write side (routes/twitter, platforms/twitter-post)
    CreateTweet: 'l4hk8uVGvR-a8kzQ4nOhPA',
    DeleteTweet: 'nxpZCY2K-I6QoFHAHeojFQ',
    AudioSpaceById: 'ipEqgz4P_bZCGY3fBnfsxQ',
};

const gqlFeatureUser = {
    hidden_profile_subscriptions_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
};
const gqlFeatureFeed = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
};

const TweetDetailFeatures = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
};
const audioSpaceFeatures = {
    ...gqlFeatureFeed,
    spaces_2022_h2_spaces_communities: true,
    spaces_2022_h2_clipping: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: false,
    premium_content_api_read_enabled: false,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    rweb_sports_post_context_enabled: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    rweb_conversational_replies_downvote_enabled: false,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    rweb_cashtags_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_nested_quote_preview_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
};
const gqlFeatures: Record<string, Record<string, boolean | string | number>> = {
    UserByScreenName: gqlFeatureUser,
    UserByRestId: gqlFeatureUser,
    UserTweets: gqlFeatureFeed,
    UserTweetsAndReplies: gqlFeatureFeed,
    UserMedia: gqlFeatureFeed,
    SearchTimeline: gqlFeatureFeed,
    ListLatestTweetsTimeline: gqlFeatureFeed,
    HomeTimeline: gqlFeatureFeed,
    HomeLatestTimeline: TweetDetailFeatures,
    TweetDetail: TweetDetailFeatures,
    Likes: gqlFeatureFeed,
    AudioSpaceById: audioSpaceFeatures,
};



/** Query ids change with every web build, the community keeps a list of the current ones. */
export const getQueryIds = () =>
    tryGet('twitter:gql-ids', async () => {
        try {
            const response = await fetch('https://cdn.jsdelivr.net/gh/fa0311/TwitterInternalAPIDocument@master/docs/json/API.json', { signal: AbortSignal.timeout(15_000) });
            const api: any = await response.json();
            const ids: Record<string, string> = {};
            for (const name of Object.keys(fallbackIds)) {
                const id = api?.graphql?.[name]?.queryId;
                if (id) {
                    ids[name] = id;
                }
            }
            return { ...fallbackIds, ...ids };
        } catch {
            return fallbackIds;
        }
    });

// --- client transaction id (x-client-transaction-id) ---
type TransactionKeys = { keyBytes: number[]; animationKey: string };
const getTransactionKeys = (refresh: boolean) =>
    tryGet<TransactionKeys>(
        'twitter:transaction-keys',
        async () => {
            const ct = (await ClientTransaction.create(await fetchXDocument())) as unknown as { keys: TransactionKeys };
            return ct.keys;
        },
        refresh ? 0 : 3600
    );
export const getTransactionId = async (method: string, path: string, refresh: boolean) => {
    const keys = await getTransactionKeys(refresh);
    return (Object.assign(Object.create(ClientTransaction.prototype), { keys }) as ClientTransaction).generateTransactionId(method, path);
};

// --- session cookies: the full jar (TWITTER_COOKIE) or only the auth_token ---
export const parseJar = (text: string): Record<string, string> => {
    const jar: Record<string, string> = {};
    for (const part of text.split(/;\s*/)) {
        const index = part.indexOf('=');
        if (index > 0) {
            jar[part.slice(0, index).trim()] = part.slice(index + 1);
        }
    }
    return jar;
};
export const cookieString = (jar: Record<string, string>) =>
    Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

export const requireCredential = () => {
    const token = getEnv('TWITTER_AUTH_TOKEN');
    const cookie = getEnv('TWITTER_COOKIE');
    if (!token && !cookie) {
        throw needsCredential('Twitter needs TWITTER_COOKIE (the cookie jar) or TWITTER_AUTH_TOKEN (the auth_token cookie of a logged-in account).');
    }
    return { token, cookie };
};

const loadCookies = async (): Promise<Record<string, string>> => {
    const { token, cookie } = requireCredential();
    const jar: Record<string, string> = cookie ? parseJar(cookie) : {};
    if (token && !jar.auth_token) {
        jar.auth_token = token;
    }
    if (!jar.auth_token) {
        throw needsCredential('TWITTER_COOKIE has no auth_token.');
    }
    if (jar.ct0) {
        return jar;
    }
    const response = await request('https://x.com', { headers: { cookie: cookieString(jar) } });
    for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        if (index > 0) {
            jar[pair.slice(0, index)] = pair.slice(index + 1);
        }
    }
    if (!jar.ct0) {
        throw needsCredential('Twitter did not accept the credential, it is expired or blocked.');
    }
    // The caller keeps the full jar next time, so the bootstrap is not repeated
    recordSession({ TWITTER_COOKIE: cookieString(jar) });
    return jar;
};

/**
 * X answers 401/403 with a fresh `ct0` when the csrf cookie went stale, the account itself is fine. Returns the renewed jar
 * (also cached and reported to the caller in X-Gate-Session), or undefined when the response brings no new `ct0`.
 */
export const renewCsrf = (jar: Record<string, string>, response: Response): Record<string, string> | undefined => {
    const fresh = response.headers
        .getSetCookie()
        .map((line) => line.split(';')[0])
        .find((pair) => pair.startsWith('ct0='))
        ?.slice(4);
    if (!fresh || fresh === jar.ct0) {
        return undefined;
    }
    const next = { ...jar, ct0: fresh };
    putCache('twitter:cookies', next, 3600);
    recordSession({ TWITTER_COOKIE: cookieString(next) });
    return next;
};

/** Keys are bound to the credentials of the request; `refresh` skips the cache. */
export const getCookies = (refresh = false) => tryGet<Record<string, string>>('twitter:cookies', loadCookies, refresh ? 0 : 3600);

type Params = Record<string, string | number | boolean | undefined>;

const twitterFetch = async (url: string, transactionPath: string | undefined, retryWithFreshId: () => Promise<any>, refreshTransactionId: boolean, csrfRetried = false): Promise<any> => {
    requireCredential();
    const cookies = await getCookies();
    const transactionId = transactionPath ? await getTransactionId('GET', transactionPath, refreshTransactionId) : undefined;
    const response = await request(url, {
        headers: {
            accept: '*/*',
            authorization: bearerToken,
            'cache-control': 'no-cache',
            'content-type': 'application/json',
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join('; '),
            referer: 'https://x.com/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-csrf-token': cookies.ct0,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': 'en',
            ...(transactionId && { 'x-client-transaction-id': transactionId }),
        },
    });
    if (response.status === 404 && transactionId && !refreshTransactionId) {
        return retryWithFreshId();
    }
    if ((response.status === 401 || response.status === 403) && !csrfRetried && renewCsrf(cookies, response)) {
        return twitterFetch(url, transactionPath, retryWithFreshId, refreshTransactionId, true);
    }
    if (response.status === 401 || response.status === 403) {
        throw needsCredential('Twitter refused TWITTER_AUTH_TOKEN, it is expired, locked or blocked.');
    }
    if (response.status === 429) {
        throw new HttpError(429, 'Twitter rate limit reached for this account, try again later.');
    }
    if (!response.ok) {
        throw new HttpError(502, `Twitter answered ${response.status}.`);
    }
    return response.json();
};

export const twitterGet = async (operation: string, variables: Params, refreshTransactionId = false): Promise<any> => {
    requireCredential();
    const ids = await getQueryIds();
    const path = `/graphql/${ids[operation]}/${operation}`;
    const query = new URLSearchParams({ variables: JSON.stringify(variables), features: JSON.stringify(gqlFeatures[operation]) });
    if (operation.startsWith('UserBy')) {
        query.set('fieldToggles', JSON.stringify({ withAuxiliaryUserLabels: false }));
    }
    const needsTransactionId = /^(UserTweetsAndReplies|SearchTimeline)$/.test(operation);
    return twitterFetch(`${baseUrl}${path}?${query}`, needsTransactionId ? `/i/api${path}` : undefined, () => twitterGet(operation, variables, true), refreshTransactionId);
};

const twitterRest = (path: string, params: Record<string, string>) => twitterFetch(`${baseUrl}${path}?${new URLSearchParams(params)}`, undefined, async () => undefined, false);

const timelineEntries = async (operation: string, userId: string | undefined, variables: Params, path?: string[]) => {
    const { data } = await twitterGet(operation, { ...variables, userId });
    let instructions: any;
    if (path) {
        instructions = data;
        for (const p of path) {
            instructions = instructions?.[p];
        }
        instructions = instructions?.instructions;
    } else {
        const result = data?.user?.result;
        instructions = (result?.timeline?.timeline || result?.timeline?.timeline_v2 || result?.timeline_v2?.timeline)?.instructions;
    }
    if (!instructions) {
        return [];
    }
    const moduleItems = instructions.find((i: any) => i.type === 'TimelineAddToModule')?.moduleItems;
    const entries = instructions.find((i: any) => i.type === 'TimelineAddEntries')?.entries ?? [];
    const gridEntries = entries.find((i: any) => i.entryId === 'profile-grid-0')?.content?.items;
    const pinned = instructions.filter((i: any) => i.type === 'TimelinePinEntry' && i.entry).map((i: any) => i.entry);
    return [...new Map([...pinned, ...(gridEntries || moduleItems || entries)].map((entry: any) => [entry.entryId, entry])).values()];
};

const hydrateLegacyTweet = (legacy: any, tweet: any) => {
    const userResult = tweet.core?.user_results?.result;
    if (userResult) {
        legacy.user = {
            name: userResult.core?.name,
            screen_name: userResult.core?.screen_name,
            profile_image_url_https: userResult.avatar?.image_url,
        };
    }
    legacy.id_str = tweet.rest_id ?? legacy.id_str;
    const note = tweet.note_tweet?.note_tweet_results?.result;
    if (typeof note?.text !== 'string') {
        return;
    }
    legacy.full_text = note.text;
    legacy.entities ??= {};
    for (const field of ['hashtags', 'symbols', 'urls', 'user_mentions']) {
        if (Array.isArray(note.entity_set?.[field])) {
            legacy.entities[field] = note.entity_set[field];
        }
    }
};

function gatherLegacyFromData(entries: any[], filterNested?: string[], userId?: number | string) {
    const tweets: any[] = [];
    const contextTweets = new Map<string, any>();
    const filteredEntries: any[] = [];
    for (const entry of entries) {
        const entryId = entry.entryId;
        if (!entryId) {
            continue;
        }
        if (entryId.startsWith('tweet-') || entryId.startsWith('profile-grid-0-tweet-')) {
            filteredEntries.push(entry);
        }
        if (filterNested && filterNested.some((f) => entryId.startsWith(f))) {
            filteredEntries.push(...entry.content.items);
        }
    }
    for (const entry of filteredEntries) {
        if (!entry.entryId) {
            continue;
        }

        const content = entry.content || entry.item;
        let tweet = content?.content?.tweetResult?.result || content?.itemContent?.tweet_results?.result;
        // Handle subscriber-only preview posts (must check before tweet.tweet reassignment)
        if (tweet?.__typename === 'TweetPreviewDisplay') {
            const preview = tweet.tweet;
            if (preview?.rest_id) {
                const userResult = preview.core?.user_results?.result;
                const fakeLegacy: any = {
                    id_str: preview.rest_id,
                    full_text: `[Subscribers Only] ${preview.text ?? ''}`,
                    created_at: preview.created_at ?? '',
                    entities: { urls: [], hashtags: [], symbols: [], user_mentions: [] },
                    user_id_str: userResult?.rest_id ?? '',
                    favorite_count: preview.favorite_count ?? 0,
                    reply_count: preview.reply_count ?? 0,
                    retweet_count: preview.retweet_count ?? 0,
                };
                hydrateLegacyTweet(fakeLegacy, { core: preview.core, rest_id: preview.rest_id });
                if (userId === undefined || fakeLegacy.user_id_str === userId + '') {
                    tweets.push(fakeLegacy);
                }
            }
            continue;
        }
        if (tweet && tweet.tweet) {
            tweet = tweet.tweet;
        }
        if (!tweet) {
            continue;
        }
        const retweetResult = tweet.legacy?.retweeted_status_result?.result;
        const retweet = retweetResult?.tweet || retweetResult;
        for (const t of [tweet, retweet]) {
            if (!t?.legacy) {
                continue;
            }
            hydrateLegacyTweet(t.legacy, t);
            contextTweets.set(t.rest_id, t.legacy);
            const quote = t.quoted_status_result?.result?.tweet || t.quoted_status_result?.result;
            if (!quote?.legacy) {
                continue;
            }
            t.legacy.quoted_status = quote.legacy;
            hydrateLegacyTweet(t.legacy.quoted_status, quote);
        }
        const legacy = tweet.legacy;
        if (!legacy) {
            continue;
        }
        if (retweet) {
            legacy.retweeted_status = retweet.legacy;
        }
        if (userId === undefined || legacy.user_id_str === userId + '') {
            tweets.push(legacy);
        }
    }

    for (const tweet of contextTweets.values()) {
        const parent = contextTweets.get(tweet.in_reply_to_status_id_str);
        if (parent && parent !== tweet) {
            tweet.in_reply_to_status = parent;
        }
    }
    return tweets;
}


// --- user lookup and timelines ---
const userResult = (response: any) => {
    const errors = response?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        throw new HttpError(502, `Twitter user lookup failed${errors[0]?.code ? ` (code ${errors[0].code})` : ''}.`);
    }
    const user = response?.data?.user;
    if (user === null || user?.result === null) {
        throw notFound("This Twitter account doesn't exist.");
    }
    const result = user?.result;
    if (result?.__typename === 'UserUnavailable') {
        throw notFound('This Twitter account is unavailable.');
    }
    if (!result?.rest_id) {
        throw new HttpError(502, 'Twitter returned an incomplete user response.');
    }
    return result;
};

const getUserData = async (id: string) => {
    const byRestId = id.startsWith('+');
    const response = await tryGet(
        `twitter:user:${id}`,
        async () => {
            const data = await twitterGet(byRestId ? 'UserByRestId' : 'UserByScreenName', byRestId ? { userId: id.slice(1), withSafetyModeUserFields: true } : { screen_name: id, withSafetyModeUserFields: true });
            userResult(data);
            return data;
        },
        86_400
    );
    return userResult(response);
};

const profileOf = (user: any) => ({
    name: user.core?.name as string | undefined,
    screenName: user.core?.screen_name as string | undefined,
    description: user.profile_bio?.description as string | undefined,
    image: (user.avatar?.image_url as string | undefined)?.replace(/_normal\.jpg$/, '.jpg'),
});

const userTimeline = async (id: string, replies: boolean) => {
    const user = await getUserData(id);
    const base = { count: 20, includePromotedContent: true, withVoice: true, withV2Timeline: true };
    const entries = replies
        ? await timelineEntries('UserTweetsAndReplies', user.rest_id, { ...base, withCommunity: true })
        : await timelineEntries('UserTweets', user.rest_id, { ...base, withQuickPromoteEligibilityTweetFields: true });
    const tweets = gatherLegacyFromData(entries, ['profile-conversation-'], user.rest_id);
    return { profile: profileOf(user), tweets: replies ? tweets : tweets.filter((t) => !t.in_reply_to_status_id_str) };
};

// --- rendering of a tweet ---
const parseTwitterDate = (value?: string) => {
    if (!value) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};

const originalImage = (url: string) => {
    let m = url.match(/^(https?:\/\/\w+\.twimg\.com\/media\/[^/:]+)\.(jpg|jpeg|gif|png|bmp|webp)(:\w+)?$/i);
    if (m) {
        return `${m[1]}?format=${m[2] === 'jpeg' ? 'jpg' : m[2]}&name=orig`;
    }
    m = url.match(/^(https?:\/\/\w+\.twimg\.com\/[^?]+)(\?.+)$/i);
    if (m) {
        const query = new URL(url).searchParams;
        const [format, name] = [query.get('format'), query.get('name')];
        return !format || !name || name === 'orig' ? url : `${m[1]}?format=${format}&name=orig`;
    }
    return url;
};

const formatText = (tweet: any): string => {
    let text: string = tweet.full_text ?? tweet.text ?? '';
    const id = tweet.id_str || tweet.conversation_id_str;
    for (const url of tweet.entities?.urls ?? []) {
        text = text.replaceAll(url.url, () => (url.expanded_url?.endsWith(id) ? '' : escapeUrlText(url.expanded_url)));
    }
    for (const media of tweet.extended_entities?.media ?? []) {
        text = text.replaceAll(media.url, '');
    }
    return text.trim().replaceAll('\n', '<br>');
};
// `&` and angle brackets inside an expanded link must not break the markup
const escapeUrlText = (url: string) => url.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const mediaHtml = (tweet: any) =>
    (tweet.extended_entities?.media ?? [])
        .map((media: any) => {
            if (media.type === 'video' || media.type === 'animated_gif') {
                const best = (media.video_info?.variants ?? []).filter((v: any) => v.url).toSorted((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                const gif = media.type === 'animated_gif' ? ' autoplay loop muted playsinline' : '';
                return best ? `<br><video src="${best.url}"${gif} controls poster="${originalImage(media.media_url_https)}"></video>` : '';
            }
            return `<br><img src="${originalImage(media.media_url_https)}">`;
        })
        .join('');

export const toItem = (original: any): Item => {
    const retweet = original.retweeted_status;
    const tweet = retweet || original;
    const text = formatText(tweet);
    const quote = tweet.is_quote_status && tweet.quoted_status?.user ? tweet.quoted_status : undefined;

    const oneLine = (html: string) => html.replaceAll(/<br><br>|<br>/g, ' ');
    let title = '';
    if (retweet) {
        title = `RT ${tweet.user?.name}: ${oneLine(text)}`;
    } else {
        title = `${tweet.in_reply_to_screen_name ? 'Re ' : ''}${oneLine(formatText(original))}`;
    }

    let html = '';
    if (retweet) {
        html += `RT&ensp;${tweet.user?.name ?? ''}<br>`;
    }
    html += `${tweet.in_reply_to_screen_name ? 'Re ' : ''}${text}${mediaHtml(tweet)}`;
    if (quote) {
        const q = quote;
        const qLink = q.user.screen_name && q.id_str ? `https://x.com/${q.user.screen_name}/status/${q.id_str}` : undefined;
        html += `<hr><div class="quote">${q.user.name}:&ensp;${formatText(q)}<br>${mediaHtml(q)}${qLink ? `<br><small>Link: <a href="${qLink}">${qLink}</a></small>` : ''}</div>`;
    }

    const user = original.user;
    const id = original.id_str || original.conversation_id_str;
    return {
        url: user?.screen_name && id ? `https://x.com/${user.screen_name}/status/${id}` : `https://x.com/${tweet.user?.screen_name}/status/${tweet.id_str || tweet.conversation_id_str}`,
        title: title || 'Tweet',
        contentHtml: html,
        published: parseTwitterDate(tweet.created_at),
        author: user?.name,
        tags: (tweet.entities?.hashtags ?? []).map((h: any) => h.text),
    };
};

// --- feeds ---
type Options = { replies?: boolean; retweets?: boolean; onlyMedia?: boolean };

const filterTweets = (tweets: any[], { retweets = true, onlyMedia = false }: Options) => tweets.filter((t) => (retweets || !t.retweeted_status) && (!onlyMedia || t.extended_entities?.media));

export const getUserFeed = async (id: string, options: Options = {}): Promise<Feed> => {
    const { profile, tweets } = await userTimeline(id.replace(/^@/, ''), options.replies ?? false);
    return {
        title: `Twitter @${profile.name}`,
        url: `https://x.com/${profile.screenName}`,
        description: profile.description,
        icon: profile.image,
        items: filterTweets(tweets, options).map((t) => toItem(t)),
    };
};

export const getHomeFeed = async (options: Options = {}): Promise<Feed> => {
    const entries = await timelineEntries('HomeTimeline', undefined, { count: 20, includePromotedContent: true, latestControlAvailable: true, requestContext: 'launch', withCommunity: true }, ['home', 'home_timeline_urt']);
    return { title: 'Twitter following timeline', url: 'https://x.com/home', items: filterTweets(gatherLegacyFromData(entries), options).map((t) => toItem(t)) };
};

export const getListFeed = async (id: string, options: Options = {}): Promise<Feed> => {
    const entries = await timelineEntries('ListLatestTweetsTimeline', undefined, { listId: id, count: 20 }, ['list', 'tweets_timeline', 'timeline']);
    return { title: `Twitter list ${id}`, url: `https://x.com/i/lists/${id}`, items: filterTweets(gatherLegacyFromData(entries, ['listConversation-']), options).map((t) => toItem(t)) };
};

export const getKeywordFeed = async (keyword: string, options: Options = {}): Promise<Feed> => {
    const entries = await timelineEntries('SearchTimeline', undefined, { rawQuery: keyword, count: 20, querySource: 'typed_query', product: 'Latest' }, ['search_by_raw_query', 'search_timeline', 'timeline']);
    return { title: `Twitter search ${keyword}`, url: `https://x.com/search?q=${encodeURIComponent(keyword)}`, items: filterTweets(gatherLegacyFromData(entries), options).map((t) => toItem(t)) };
};

export const getTweetFeed = async (id: string, status: string): Promise<Feed> => {
    const user = await getUserData(id.replace(/^@/, ''));
    const entries = await timelineEntries(
        'TweetDetail',
        user.rest_id,
        { focalTweetId: status, with_rux_injections: false, includePromotedContent: true, withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true, withV2Timeline: true },
        ['threaded_conversation_with_injections_v2']
    );
    const profile = profileOf(user);
    return {
        title: `Twitter @${profile.name}`,
        url: `https://x.com/${profile.screenName}/status/${status}`,
        description: profile.description,
        icon: profile.image,
        items: gatherLegacyFromData(entries, ['homeConversation-', 'conversationthread-']).map((t) => toItem(t)),
    };
};

const mediaTimeline = async (operation: 'UserMedia' | 'Likes', id: string, variables: Params, options: Options) => {
    const user = await getUserData(id.replace(/^@/, ''));
    const entries = await timelineEntries(operation, user.rest_id, { count: 20, includePromotedContent: false, withVoice: true, withV2Timeline: true, ...variables });
    // Likes belong to other authors, so they are not filtered by the user id
    const tweets = gatherLegacyFromData(entries, ['profile-conversation-'], operation === 'UserMedia' ? user.rest_id : undefined);
    return { profile: profileOf(user), tweets: filterTweets(tweets, options) };
};

export const getMediaFeed = async (id: string, options: Options = {}): Promise<Feed> => {
    const { profile, tweets } = await mediaTimeline('UserMedia', id, { withClientEventToken: false, withBirdwatchNotes: false }, options);
    return {
        title: `Twitter @${profile.name}`,
        url: `https://x.com/${profile.screenName}/media`,
        description: profile.description,
        icon: profile.image,
        items: tweets.map((t) => toItem(t)),
    };
};

export const getLikesFeed = async (id: string, options: Options = {}): Promise<Feed> => {
    const name = id.replace(/^@/, '');
    const { tweets } = await mediaTimeline('Likes', name, { includeHasBirdwatchNotes: false, withBirdwatchNotes: false, withVoice: false }, options);
    return { title: `Twitter Likes - ${name}`, url: `https://x.com/${name}/likes`, items: tweets.map((t) => toItem(t)) };
};

export const getHomeLatestFeed = async (options: Options = {}): Promise<Feed> => {
    const entries = await timelineEntries('HomeLatestTimeline', undefined, { count: 20, includePromotedContent: true, latestControlAvailable: true, requestContext: 'launch', withCommunity: true }, ['home', 'home_timeline_urt']);
    return { title: 'Twitter following timeline', url: 'https://x.com/home', items: filterTweets(gatherLegacyFromData(entries), options).map((t) => toItem(t)) };
};

/** Trends need a developer app (TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET), not the web session. */
export const getTrendsFeed = async (woeid = '1'): Promise<Feed> => {
    const key = getEnv('TWITTER_CONSUMER_KEY');
    const secret = getEnv('TWITTER_CONSUMER_SECRET');
    if (!key || !secret) {
        throw needsCredential('Twitter trends need TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET (a developer app).');
    }
    if (!/^\d+$/.test(woeid)) {
        throw badRequest('woeid must be a number such as 1 (world) or 23424856 (Japan).');
    }
    const bearer = await tryGet(
        `twitter:app-token:${key.slice(-6)}`,
        async () => {
            const response = await request('https://api.twitter.com/oauth2/token', {
                method: 'POST',
                headers: { authorization: `Basic ${Buffer.from(`${encodeURIComponent(key)}:${encodeURIComponent(secret)}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: 'grant_type=client_credentials',
            });
            const body: any = await response.json().catch(() => ({}));
            if (!response.ok || !body.access_token) {
                throw needsCredential('Twitter refused TWITTER_CONSUMER_KEY / TWITTER_CONSUMER_SECRET.');
            }
            return body.access_token as string;
        },
        3600
    );
    const response = await request(`https://api.twitter.com/1.1/trends/place.json?id=${woeid}`, { headers: { authorization: `Bearer ${bearer}` } });
    if (response.status === 429) {
        throw new HttpError(429, 'Twitter rate limit reached, try again later.');
    }
    if (!response.ok) {
        throw new HttpError(502, `Twitter answered ${response.status}.`);
    }
    const [data]: any[] = await response.json();
    return {
        title: `Twitter Trends on ${data?.locations?.[0]?.name ?? woeid}`,
        url: 'https://x.com/i/trends',
        items: (data?.trends ?? [])
            .filter((t: any) => !t.promoted_content)
            .map((t: any) => ({ url: t.url, title: t.name, contentHtml: t.name + (t.tweet_volume ? ` (${t.tweet_volume})` : '') })),
    };
};

/** Whether a user is hosting or speaking in a live Space right now. */
export const getSpacesFeed = async (username: string): Promise<Feed> => {
    const name = username.replace(/^@/, '');
    if (!/^\w{1,15}$/.test(name)) {
        throw badRequest('Use a valid X username without @.');
    }
    const user = await getUserData(name);
    const profile = profileOf(user);
    const link = `https://x.com/${profile.screenName ?? name}`;
    const idle = (speaking: boolean): Feed => ({
        title: `${profile.screenName ?? name} - Space speaking status`,
        url: link,
        items: [{ url: `${link}#spaces-inactive`, title: `${profile.name} is not ${speaking ? 'speaking ' : ''}in a live Space`, contentHtml: '', author: profile.name }],
    });
    const presence = await twitterRest('/fleets/v1/avatar_content', { user_ids: user.rest_id });
    const current = presence?.users?.[user.rest_id]?.spaces?.live_content?.audiospace?.id;
    if (!current) {
        return idle(false);
    }
    const response = await twitterGet('AudioSpaceById', { id: current, isMetatagsQuery: false, withReplays: true, withListeners: false });
    const space = response?.data?.audioSpace;
    if (!space) {
        throw new HttpError(502, 'Twitter returned no metadata for the current Space.');
    }
    const hosting = space.participants?.admins?.some((p: any) => p.user_results?.rest_id === user.rest_id);
    const speaking = space.participants?.speakers?.some((p: any) => p.user_results?.rest_id === user.rest_id);
    if (space.metadata?.state !== 'Running' || (!hosting && !speaking)) {
        return idle(true);
    }
    const url = `https://x.com/i/spaces/${space.metadata.rest_id}`;
    return {
        title: `${profile.screenName ?? name} - Space speaking status`,
        url: link,
        items: [{ url, title: `${profile.name} is ${hosting ? 'hosting' : 'speaking in'} ${space.metadata.title || 'a live Space'}`, contentHtml: '', author: profile.name, published: new Date(space.metadata.started_at), tags: [hosting ? 'host' : 'speaker'] }],
    };
};
