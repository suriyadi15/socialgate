# socialgate

A small stateless service for a backend of your own: it **reads** feeds (JSON Feed 1.1) of Twitter/X, Instagram, Threads, Facebook, TikTok and YouTube, **posts** to X, and **checks and renews the session** of an account.
Credentials and a proxy travel with each request, nothing is stored. It is the merge of rssgate (read) and postgate (write): both used the same cookie, so there is one session per account now. The scraping logic is ported from [RSSHub](https://github.com/DIYgod/RSSHub), see `UPSTREAM.md`.

## Run

```bash
docker run -d -p 3000:3000 -e ACCESS_KEY=change-me ghcr.io/suriyadi15/socialgate:latest
# or build it yourself: docker build -t socialgate .
# or without Docker: bun install && ACCESS_KEY=change-me bun src/index.ts
```

Image tags on `ghcr.io/suriyadi15/socialgate` (linux/amd64 and linux/arm64): `latest` is the head of `main`, `sha-<commit>` is one build, `X.Y.Z` and `X.Y` follow the git tags `vX.Y.Z`.

| Env           | Default | Meaning                                                  |
| ------------- | ------- | -------------------------------------------------------- |
| `ACCESS_KEY`  | none    | Required, the process stops without it                   |
| `PORT`        | 3000    |                                                          |
| `CACHE_TTL`   | 300     | Seconds a finished feed is kept                          |
| `CONTENT_TTL` | 3600    | Seconds details (user ids, tokens, ...) are kept         |

The credential keys below and `PROXY_URI` may also be set as process env, they are the defaults for requests that bring none.

## Request

```bash
curl -H 'Authorization: Bearer change-me' \
     -H 'X-Gate-Config: {"TWITTER_COOKIE":"<cookie jar, or just auth_token=...>","PROXY_URI":"socks5h://user:pass@host:1080"}' \
     'http://localhost:3000/twitter/user/jack?limit=10'
```

- `Authorization: Bearer <ACCESS_KEY>` (or `?key=`) is required, except for `/healthz`.
- `X-Gate-Config` (`X-Rssgate-Config` and `X-Postgate-Config` still work) is a JSON object, only the credential keys of the table [below](#credentials-and-example-values) and `PROXY_URI` (`http`, `https`, `socks5`, `socks5h`) are accepted. Values are never logged or echoed.
- `limit=N` (1..100) trims the items. `Cache-Control: no-cache` skips the feed cache.
- Cache entries are keyed by the credentials of the request: data fetched with one account is never served to another account or to a request without credentials.

## Routes

Every route answers JSON Feed 1.1. `limit`, `Cache-Control: no-cache` and the credentials work the same on all of them. The query options of a route are listed in its table, for the rest of RSSHub's `:routeParams` (display tweaks such as `showAuthorInTitle`) there is no equivalent.

Platforms: [X / Twitter](#x--twitter) · [Instagram](#instagram) · [Threads](#threads) · [Facebook](#facebook) · [TikTok](#tiktok) · [YouTube](#youtube)

### X / Twitter

Query options of the timeline routes: `includeReplies` (user only, default false), `includeRts` (default true), `onlyMedia` (default false).

| Route                               | Credential                                       | Query                                       | Returns                                        |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------- | ---------------------------------------------- |
| `/twitter/user/:id`                 | `TWITTER_AUTH_TOKEN`                             | `includeReplies`, `includeRts`, `onlyMedia` | Tweets of a user, `:id` is a username or `+<numeric id>` |
| `/twitter/media/:id`                | `TWITTER_AUTH_TOKEN`                             | `includeRts`, `onlyMedia`                   | Media tab of a user                            |
| `/twitter/likes/:id`                | `TWITTER_AUTH_TOKEN`                             | `includeRts`, `onlyMedia`                   | Tweets a user liked                            |
| `/twitter/home`                     | `TWITTER_AUTH_TOKEN`                             | `includeRts`, `onlyMedia`                   | "For you" timeline of the account              |
| `/twitter/home_latest`              | `TWITTER_AUTH_TOKEN`                             | `includeRts`, `onlyMedia`                   | "Following" timeline of the account            |
| `/twitter/list/:id`                 | `TWITTER_AUTH_TOKEN`                             | `includeRts`, `onlyMedia`                   | Tweets of a list                               |
| `/twitter/keyword/:keyword`         | `TWITTER_AUTH_TOKEN`                             | `includeRts`, `onlyMedia`                   | Search results (latest)                        |
| `/twitter/tweet/:id/status/:status` | `TWITTER_AUTH_TOKEN`                             |                                             | A tweet and its thread                         |
| `/twitter/spaces/:username`         | `TWITTER_AUTH_TOKEN`                             |                                             | Whether the user hosts or speaks in a live Space |
| `/twitter/trends/:woeid?`           | `TWITTER_CONSUMER_KEY` + `TWITTER_CONSUMER_SECRET` |                                           | Trends of a place, `woeid` defaults to 1 (world); needs a developer app, not the web session |

```bash
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Gate-Config: {"TWITTER_AUTH_TOKEN":"0a1b2c3d4e5f60718293a4b5c6d7e8f901234567"}' \
     'http://localhost:3000/twitter/media/jack?limit=10'
```

### Instagram

| Route                          | Credential                                          | Returns                                   |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------- |
| `/instagram/user/:user`        | optional `INSTAGRAM_COOKIE` (needed for private)    | Posts of a user                           |
| `/instagram/stories/:user`     | `INSTAGRAM_COOKIE`                                  | Current stories of a user                 |
| `/instagram/highlights/:user`  | `INSTAGRAM_COOKIE`                                  | Highlighted stories of a user             |
| `/instagram/tags/:tag`         | `INSTAGRAM_COOKIE`                                  | Top posts of a hashtag, without the `#`   |

```bash
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Gate-Config: {"INSTAGRAM_COOKIE":"sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123"}' \
     'http://localhost:3000/instagram/stories/someuser'
```

### Threads

No credential. Query options: `replies` (user, default false), `serpType` (search, `tags` / `default` / `recent`, default `tags`).

| Route                         | Query       | Returns                          |
| ----------------------------- | ----------- | -------------------------------- |
| `/threads/:user`              | `replies`   | Threads of a user                |
| `/threads/:user/post/:id`     |             | A post and its replies           |
| `/threads/search/:keyword`    | `serpType`  | Search results                   |

```bash
curl -H 'Authorization: Bearer replace-with-a-long-random-string' 'http://localhost:3000/threads/zuck?limit=10'
```

### Facebook

| Route                  | Credential                                                        | Returns                              |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `/facebook/page/:id`   | optional `FACEBOOK_COOKIE`                                        | Posts of a page                      |
| `/facebook/group/:id`  | optional `FACEBOOK_COOKIE` (public groups; most need it)         | Posts of a group, `:id` is a number or a group name |
| `/facebook/photos/:id` | optional `FACEBOOK_COOKIE`                                        | Photos of a page or profile          |
| `/facebook/reels/:id`  | optional `FACEBOOK_COOKIE`                                        | Reels of a page or profile           |

```bash
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Gate-Config: {"FACEBOOK_COOKIE":"c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1"}' \
     'http://localhost:3000/facebook/group/613870175328566'
```

### TikTok

No credential.

| Route                 | Returns                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `/tiktok/user/:user`  | Videos of a user                                                         |
| `/tiktok/live/:user`  | Whether the user is live; the status is part of the item id, so a change shows up as a new item |

```bash
curl -H 'Authorization: Bearer replace-with-a-long-random-string' 'http://localhost:3000/tiktok/live/@tiktok'
```

### YouTube

Only subscriptions needs credentials. `:username` is a handle (`@NASA`) or a channel id (`UC...`).

| Route                                      | Credential                                                              | Returns                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/youtube/channel/:id`                     | none                                                                    | Videos of a channel id                                         |
| `/youtube/user/:handle`                    | none                                                                    | Videos of a handle                                             |
| `/youtube/c/:username`                     | none                                                                    | Videos of a custom URL (`youtube.com/c/name`)                  |
| `/youtube/playlist/:id`                    | none                                                                    | Videos of a playlist                                           |
| `/youtube/community/:handle`               | none                                                                    | Community posts                                                |
| `/youtube/live/:username`                  | none                                                                    | Live, upcoming and past streams; the state is the item `tags`  |
| `/youtube/shows/:username`                 | none                                                                    | Shows of a channel                                             |
| `/youtube/charts/:category?/:country?`     | none                                                                    | YouTube Music charts. `category`: `TopVideos` (default), `TopSongs`, `TopArtists`, `TrendingVideos`; `country` a code such as `us`, default global. `?country=` also works for the default category |
| `/youtube/subscriptions`                   | `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` + `YOUTUBE_REFRESH_TOKEN` | Latest uploads of the channels an account subscribes to        |

`/youtube/charts` depends on a web key of the charts site that RSSHub ships and Google may revoke; it answers 502 while that is the case.

```bash
curl -H 'Authorization: Bearer replace-with-a-long-random-string' 'http://localhost:3000/youtube/live/@NASA'
```

Errors are `{"error":{"message":"..."}}`: 400 bad parameter or header, 401 wrong key, 404 not found, 429 platform rate limit, 502 platform failure, 503 credential missing/expired/blocked.

## Write and session routes

Not cached, never retried (a repeated write could publish twice). Errors are `{"error":{"message":"..."}}`: 400 bad input, 401 wrong key, 404 not found, 409 duplicate, 413 too large, 422 refused by the platform (looks automated), 429 rate limit, 502 platform failure, 503 credential missing/expired/locked.

| Route                       | Body                                              | Returns                              |
| --------------------------- | ------------------------------------------------- | ------------------------------------ |
| `GET /twitter/session`      | query `username` (recommended)                    | `{account: {id, username, name}}`    |
| `GET /instagram/session`    |                                                   | `{account: {id}}`                    |
| `GET /facebook/session`     |                                                   | `{account: {id}}`                    |
| `GET /twitter/me`           |                                                   | `{id, username, name}`               |
| `POST /twitter/tweet`       | `{text, replyTo?, quoteUrl?, sensitive?, media?}` | `{id, url}`                          |
| `DELETE /twitter/tweet/:id` |                                                   | `{id, deleted: true}`                |

`/session` always asks the platform (no cache). For X pass `?username=<account>`: the check is a logged-in `UserByScreenName` read, the call X accepts reliably; without it the account id comes from the `twid` cookie, and a jar without `twid` only proves that X handed out a `ct0`.
`/session` answers: 200 means the credential is alive, 503 that it is expired or locked, 429 that the account is limited.
When the platform changed the cookies during a request (new `ct0`, a jar built from a bare `auth_token`, a refreshed Facebook cookie), the response carries `X-Gate-Session: {"TWITTER_COOKIE":"auth_token=...; ct0=..."}`, the same shape as `X-Gate-Config`. The caller stores it and sends it next time; the gateway itself keeps nothing.
`replyTo` is a tweet id or URL, `quoteUrl` a tweet URL. `media` is up to 4 images, or one GIF or video, each `{"url": "https://..."}` or `{"data": "<base64>", "type": "image/png"}`. Limits: image 5 MB, GIF 15 MB, video 512 MB (the JSON body is capped at 32 MB, use `url` for large files).

> Posting through the web session is against X's terms and can get an account locked (error codes 226 / 326). Use a test account first. Query ids change with X's web builds, when a call breaks compare with [TwitterInternalAPIDocument](https://github.com/fa0311/TwitterInternalAPIDocument).

```bash
curl -X POST -H 'Authorization: Bearer change-me' \
     -H 'X-Gate-Config: {"TWITTER_COOKIE":"auth_token=0a1b2c3d4e5f60718293a4b5c6d7e8f901234567"}' \
     -H 'Content-Type: application/json' -d '{"text":"hello"}' \
     http://localhost:3000/twitter/tweet
```

## Credentials and example values

All values below are fake.

```bash
# Process env
ACCESS_KEY=replace-with-a-long-random-string   # required
PORT=3000
CACHE_TTL=300        # seconds a finished feed is cached
CONTENT_TTL=3600     # seconds details (user ids, tokens, ...) are cached
```

| Key                  | Example value                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `TWITTER_AUTH_TOKEN` | `0a1b2c3d4e5f60718293a4b5c6d7e8f901234567` (only the value of the `auth_token` cookie from x.com)    |
| `INSTAGRAM_COOKIE`   | `sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123; ds_user_id=12345678`                       |
| `FACEBOOK_COOKIE`    | `c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1; datr=AbCdEfGhIjKl`               |
| `TWITTER_CONSUMER_KEY` / `TWITTER_CONSUMER_SECRET` | API key and secret of a developer app (`/twitter/trends` only)                                      |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | OAuth client of a Google Cloud project with the YouTube Data API enabled, and a refresh token of the account for the scope `https://www.googleapis.com/auth/youtube.readonly` (`/youtube/subscriptions` only) |
| `PROXY_URI`          | `socks5h://user:pass@127.0.0.1:1080` or `http://user:pass@proxy.example.com:8080`                   |

Example request per credential:

```bash
# Twitter + proxy
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Gate-Config: {"TWITTER_AUTH_TOKEN":"0a1b2c3d4e5f60718293a4b5c6d7e8f901234567","PROXY_URI":"socks5h://user:pass@127.0.0.1:1080"}' \
     'http://localhost:3000/twitter/user/jack?limit=10'

# Instagram, private account
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Gate-Config: {"INSTAGRAM_COOKIE":"sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123"}' \
     'http://localhost:3000/instagram/user/someprivateuser'

# Facebook
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Gate-Config: {"FACEBOOK_COOKIE":"c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1; datr=AbCdEfGhIjKl"}' \
     'http://localhost:3000/facebook/page/Meta'
```

Notes:

- `PROXY_URI` accepts the protocols `http`, `https`, `socks5` and `socks5h`.
- Instagram and Facebook cookies are sent exactly like the browser `Cookie` header: `name=value` pairs separated by `; `. The easiest way to get them is to copy the header from the Network tab of DevTools.
- Instagram needs `sessionid` (and `csrftoken` when present). Facebook needs `c_user` and `xs`.
- Inside JSON, quotes within a value must be escaped. Leave `%3A` as it is.
- Threads, TikTok and YouTube (except subscriptions) need no credentials, only `PROXY_URI` applies to them.

## Develop

```bash
bun install
bun test
bunx tsc --noEmit
scripts/check-upstream.sh   # RSSHub fixes to adopt (clones the official repo into ~/.cache/socialgate)
```

Layout: `src/platforms/*` talk to one platform each (`twitter-post.ts` is the write side of X), `src/routes/*` map URLs to them (`routes/session.ts` holds the write and session routes), `src/{context,cache,http,feed}.ts` are the shared parts.
A GitHub Action (`.github/workflows/upstream.yml`) runs the same check every Monday and opens or updates an issue when RSSHub changed a ported file.
Platforms change often; when a feed breaks, compare with the RSSHub files in `UPSTREAM.md` first.

## Releasing

```bash
bun pm version patch      # or minor / major: updates package.json, commits and tags vX.Y.Z
git push --follow-tags    # the Docker workflow then publishes X.Y.Z and X.Y
gh release create vX.Y.Z --generate-notes
```

While the version is 0.x, minor bumps may change routes or response shapes.

## License

AGPL-3.0, see `LICENSE`. The scraping logic is derived from [RSSHub](https://github.com/DIYgod/RSSHub) (AGPL-3.0), see `UPSTREAM.md` for the mapping.
