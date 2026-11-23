// Write side of X (post, delete, me, session), ported from postgate. It shares the session handling (cookies, query ids,
// x-client-transaction-id) with the read routes in ./twitter, so one account has one session.
import { recordSession } from '../context';
import { badRequest, HttpError, needsCredential, notFound } from '../errors';
import { request } from '../http';
import { apiUrl, bearerToken, cookieString, getCookies, getQueryIds, getTransactionId, requireCredential } from './twitter';

const uploadUrl = 'https://upload.x.com/i/media/upload.json';

const createTweetFeatures = {
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    rweb_sports_post_context_enabled: true,
    x_elections_post_context_enabled: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    rweb_conversational_replies_downvote_enabled: false,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    responsive_web_nested_quote_preview_enabled: true,
    articles_preview_enabled: true,
    rweb_cashtags_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
};
const userFeatures = {
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


type Call = {
    method?: 'GET' | 'POST';
    json?: unknown;
    body?: FormData | URLSearchParams;
    /** Path signed into x-client-transaction-id, the web client sends one with every mutation. */
    transactionPath?: string;
    timeout?: number;
    /** Skip the cached cookies and bootstrap again (used by the session check). */
    refreshCookies?: boolean;
};

/** A call to the web API as the logged-in account. A 404 that comes with a transaction id is retried once with fresh keys. */
const twitterCall = async (url: string, call: Call = {}, refreshTransactionId = false): Promise<Response> => {
    const cookies = await getCookies(call.refreshCookies);
    const method = call.method ?? 'GET';
    const transactionId = call.transactionPath ? await getTransactionId(method, call.transactionPath, refreshTransactionId) : undefined;
    const response = await request(url, {
        method,
        json: call.json,
        body: call.body,
        timeout: call.timeout,
        retries: 0,
        headers: {
            accept: '*/*',
            authorization: bearerToken,
            'cache-control': 'no-cache',
            cookie: cookieString(cookies),
            origin: 'https://x.com',
            referer: 'https://x.com/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'x-csrf-token': cookies.ct0,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': 'en',
            ...(transactionId && { 'x-client-transaction-id': transactionId }),
        },
    });
    // X rotates cookies (ct0, ...) now and then: report the new jar to the caller so it can store it
    const rotated = { ...cookies };
    for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        if (index > 0 && pair.slice(index + 1) !== '') {
            rotated[pair.slice(0, index)] = pair.slice(index + 1);
        }
    }
    if (cookieString(rotated) !== cookieString(cookies)) {
        recordSession({ TWITTER_COOKIE: cookieString(rotated) });
    }
    // A rejected transaction id never reaches the action, so repeating the call cannot post twice
    if (response.status === 404 && transactionId && !refreshTransactionId) {
        return twitterCall(url, call, true);
    }
    if (response.status === 401 || response.status === 403) {
        throw needsCredential('Twitter refused the credential (TWITTER_AUTH_TOKEN / TWITTER_COOKIE), it is expired, locked or blocked.');
    }
    if (response.status === 429) {
        throw new HttpError(429, 'Twitter rate limit reached for this account, try again later.');
    }
    return response;
};

/** Twitter answers 200 with `errors` for most refusals, the codes decide what the caller should do. */
export const mapGraphqlError = (errors: Array<{ code?: number; message?: string }>): HttpError => {
    const first = errors[0] ?? {};
    const message = `Twitter: ${first.message ?? 'unknown error'}${first.code ? ` (code ${first.code})` : ''}`;
    switch (first.code) {
        case 187: // duplicate status
            return new HttpError(409, message);
        case 186: // too long
        case 189: // tweet cannot be found to reply to / quote
            return new HttpError(400, message);
        case 144: // status does not exist
            return notFound(message);
        case 64: // suspended
        case 32: // could not authenticate
        case 89: // invalid or expired token
        case 326: // account locked, needs verification
            return needsCredential(message);
        case 88: // rate limit
        case 185: // daily post limit
            return new HttpError(429, message);
        case 226: // looks automated
        case 344: // limit reached
        case 220: // not allowed to act on this tweet
            return new HttpError(422, message);
        default:
            return new HttpError(502, message);
    }
};

const graphql = async (operation: 'CreateTweet' | 'DeleteTweet', variables: unknown, features: unknown) => {
    const ids = await getQueryIds();
    const path = `/graphql/${ids[operation]}/${operation}`;
    const response = await twitterCall(`${apiUrl}${path}`, { method: 'POST', json: { variables, features, queryId: ids[operation] }, transactionPath: `/i/api${path}` });
    let data: any;
    try {
        data = await response.json();
    } catch {
        throw new HttpError(502, `Twitter answered ${response.status} without JSON.`);
    }
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
        throw mapGraphqlError(data.errors);
    }
    if (!response.ok) {
        throw new HttpError(502, `Twitter answered ${response.status}.`);
    }
    return data;
};

// --- media ---
export type MediaInput = { url?: string; data?: string; type?: string };
type Category = 'tweet_image' | 'tweet_gif' | 'tweet_video';

const limits: Record<Category, number> = { tweet_image: 5 * 1024 * 1024, tweet_gif: 15 * 1024 * 1024, tweet_video: 512 * 1024 * 1024 };
const chunkSize = 4 * 1024 * 1024;

export const categoryOf = (type: string): Category => {
    if (type === 'image/gif') {
        return 'tweet_gif';
    }
    if (type.startsWith('image/')) {
        return 'tweet_image';
    }
    if (type.startsWith('video/')) {
        return 'tweet_video';
    }
    throw badRequest(`Unsupported media type "${type}", expected an image, a GIF or a video.`);
};

export const chunks = (bytes: Uint8Array, size = chunkSize): Uint8Array[] => {
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += size) {
        parts.push(bytes.subarray(offset, offset + size));
    }
    return parts;
};

const loadMedia = async (media: MediaInput): Promise<{ bytes: Uint8Array; type: string; category: Category }> => {
    let bytes: Uint8Array;
    let type: string;
    if (media.url) {
        let url: URL;
        try {
            url = new URL(media.url);
        } catch {
            throw badRequest(`media.url "${media.url}" is not a URL.`);
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw badRequest('media.url must be http or https.');
        }
        const response = await request(url.toString(), { timeout: 120, retries: 1 });
        if (!response.ok) {
            throw badRequest(`media.url answered ${response.status}.`);
        }
        type = (media.type ?? response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        bytes = new Uint8Array(await response.arrayBuffer());
    } else if (media.data) {
        if (!media.type) {
            throw badRequest('media.type is required with media.data, for example "image/png".');
        }
        type = media.type.toLowerCase();
        bytes = new Uint8Array(Buffer.from(media.data, 'base64'));
    } else {
        throw badRequest('Each media needs "url" or "data" with "type".');
    }
    const category = categoryOf(type);
    if (bytes.length === 0) {
        throw badRequest('The media is empty.');
    }
    if (bytes.length > limits[category]) {
        throw new HttpError(413, `The ${category.replace('tweet_', '')} is larger than ${limits[category] / 1024 / 1024} MB.`);
    }
    return { bytes, type, category };
};

const upload = async (command: Record<string, string>, extra?: { index: number; chunk: Uint8Array }) => {
    let response: Response;
    if (extra) {
        const form = new FormData();
        for (const [k, v] of Object.entries(command)) {
            form.set(k, v);
        }
        form.set('segment_index', String(extra.index));
        form.set('media', new Blob([extra.chunk as BlobPart]), 'blob');
        response = await twitterCall(uploadUrl, { method: 'POST', body: form, timeout: 120 });
    } else if (command.command === 'STATUS') {
        response = await twitterCall(`${uploadUrl}?${new URLSearchParams(command)}`);
    } else {
        response = await twitterCall(uploadUrl, { method: 'POST', body: new URLSearchParams(command) });
    }
    if (!response.ok) {
        const detail = await response.text().then((t) => t.slice(0, 200)).catch(() => '');
        throw new HttpError(502, `Twitter media upload answered ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Loaded = Awaited<ReturnType<typeof loadMedia>>;

const uploadMedia = async ({ bytes, type, category }: Loaded): Promise<string> => {
    const init = await upload({ command: 'INIT', total_bytes: String(bytes.length), media_type: type, media_category: category });
    const id: string = init.media_id_string;
    if (!id) {
        throw new HttpError(502, 'Twitter media upload did not return a media id.');
    }
    for (const [index, chunk] of chunks(bytes).entries()) {
        // eslint-disable-next-line no-await-in-loop
        await upload({ command: 'APPEND', media_id: id }, { index, chunk });
    }
    let info = (await upload({ command: 'FINALIZE', media_id: id })).processing_info;
    const deadline = Date.now() + 120_000;
    while (info && (info.state === 'pending' || info.state === 'in_progress')) {
        if (Date.now() > deadline) {
            throw new HttpError(502, 'Twitter took too long to process the media.');
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.max(1, info.check_after_secs ?? 2) * 1000);
        // eslint-disable-next-line no-await-in-loop
        info = (await upload({ command: 'STATUS', media_id: id })).processing_info;
    }
    if (info?.state === 'failed') {
        throw badRequest(`Twitter rejected the media: ${info.error?.message ?? 'processing failed'}.`);
    }
    return id;
};

// --- tweets ---
export type TweetInput = { text: string; replyTo?: string; quoteUrl?: string; sensitive?: boolean; media?: MediaInput[] };

/** Accepts a tweet id or a tweet URL. */
export const tweetIdOf = (value: string): string => {
    const id = value.match(/^\d{1,25}$/)?.[0] ?? value.match(/\/status(?:es)?\/(\d{1,25})/)?.[0].replace(/\D/g, '');
    if (!id) {
        throw badRequest(`"${value}" is not a tweet id or tweet URL.`);
    }
    return id;
};

export const buildCreateTweetVariables = (input: TweetInput, mediaIds: string[] = []) => ({
    tweet_text: input.text,
    dark_request: false,
    media: { media_entities: mediaIds.map((media_id) => ({ media_id, tagged_users: [] })), possibly_sensitive: input.sensitive ?? false },
    semantic_annotation_ids: [],
    ...(input.replyTo && { reply: { in_reply_to_tweet_id: tweetIdOf(input.replyTo), exclude_reply_user_ids: [] } }),
    ...(input.quoteUrl && { attachment_url: input.quoteUrl }),
});

/** A tweet takes up to 4 images, or exactly one GIF or video. */
export const checkMedia = (categories: Category[]) => {
    if (categories.length > 4) {
        throw badRequest('A tweet takes at most 4 media.');
    }
    if (categories.length > 1 && categories.some((c) => c !== 'tweet_image')) {
        throw badRequest('A GIF or a video cannot be combined with other media.');
    }
};

export const postTweet = async (input: TweetInput) => {
    requireCredential();
    if ((input.media?.length ?? 0) > 4) {
        throw badRequest('A tweet takes at most 4 media.');
    }
    if (!input.text.trim() && !input.media?.length) {
        throw badRequest('Send "text", "media" or both.');
    }
    if (input.quoteUrl && !/^https?:\/\/(?:[\w.-]+\.)?(?:x|twitter)\.com\/.+\/status\/\d+/.test(input.quoteUrl)) {
        throw badRequest('"quoteUrl" must be the URL of a tweet.');
    }
    if (input.replyTo) {
        tweetIdOf(input.replyTo);
    }
    // Everything is downloaded and checked before the first byte is uploaded
    const loaded: Loaded[] = [];
    for (const media of input.media ?? []) {
        // eslint-disable-next-line no-await-in-loop
        loaded.push(await loadMedia(media));
    }
    checkMedia(loaded.map((m) => m.category));
    const mediaIds: string[] = [];
    for (const media of loaded) {
        // Upload one by one, the order of the array is the order in the tweet
        // eslint-disable-next-line no-await-in-loop
        mediaIds.push(await uploadMedia(media));
    }
    const data = await graphql('CreateTweet', buildCreateTweetVariables(input, mediaIds), createTweetFeatures);
    const result = data?.data?.create_tweet?.tweet_results?.result;
    const id: string | undefined = result?.rest_id ?? result?.tweet?.rest_id;
    if (!id) {
        throw new HttpError(502, 'Twitter did not return the new tweet.');
    }
    const username: string | undefined = result?.core?.user_results?.result?.core?.screen_name ?? result?.core?.user_results?.result?.legacy?.screen_name;
    return { id, url: `https://x.com/${username ?? 'i/web'}/status/${id}` };
};

export const deleteTweet = async (idOrUrl: string) => {
    const id = tweetIdOf(idOrUrl);
    const data = await graphql('DeleteTweet', { tweet_id: id, dark_request: false }, {});
    if (!data?.data?.delete_tweet?.tweet_results) {
        throw new HttpError(502, 'Twitter did not confirm the deletion.');
    }
    return { id, deleted: true };
};

export const getMe = async (refreshCookies = false) => {
    requireCredential();
    const settingsResponse = await twitterCall(`${apiUrl}/1.1/account/settings.json`, { refreshCookies });
    if (!settingsResponse.ok) {
        throw new HttpError(502, `Twitter answered ${settingsResponse.status}.`);
    }
    const username: string | undefined = ((await settingsResponse.json()) as any)?.screen_name;
    if (!username) {
        throw needsCredential('Twitter did not return the account of the credential.');
    }
    const ids = await getQueryIds();
    const query = new URLSearchParams({
        variables: JSON.stringify({ screen_name: username, withSafetyModeUserFields: true }),
        features: JSON.stringify(userFeatures),
        fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: false }),
    });
    const response = await twitterCall(`${apiUrl}/graphql/${ids.UserByScreenName}/UserByScreenName?${query}`);
    const user = response.ok ? ((await response.json()) as any)?.data?.user?.result : undefined;
    return { id: user?.rest_id as string | undefined, username, name: (user?.core?.name ?? user?.legacy?.name) as string | undefined };
};

/** Health of the credential: the account it belongs to, checked live. 503 = expired/locked, 429 = limited. */
export const getSession = async () => ({ account: await getMe(true) });
