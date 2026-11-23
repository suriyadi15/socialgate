# Upstream map

Code here is a rewrite of the scraping logic of [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub). Nothing is merged from it; fixes and new routes are adopted by hand.

`scripts/check-upstream.sh` lists the RSSHub commits that touched the files below since the commit recorded in the last column.
Adopt what matters, then move the commit forward in this table.

| socialgate file                    | RSSHub files (under `lib/routes/`)                                                                                                                                  | adopted up to |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/platforms/youtube.ts`      | `youtube/api/youtubei.ts`, `youtube/channel.ts`, `youtube/user.ts`, `youtube/playlist.ts`, `youtube/community.tsx`, `youtube/custom.ts`, `youtube/live.ts`, `youtube/shows.ts`, `youtube/charts.ts`, `youtube/subscriptions.ts`, `youtube/utils.tsx`                                                  | 9ee2826    |
| `src/platforms/threads.ts`      | `threads/utils.ts`, `threads/index.ts`, `threads/search.ts`, `threads/post.ts`                                                                                                                              | 9ee2826    |
| `src/platforms/tiktok.ts`       | `tiktok/user.ts`, `tiktok/live.ts`, `juejin/utils.ts` (WAF solver)                                                                                                                    | 9ee2826    |
| `src/platforms/instagram.ts`    | `instagram/index.ts` (user, stories, highlights, tags), `instagram/web-api/utils.ts`, `instagram/templates/render.ts`                                                                                 | 9ee2826    |
| `src/platforms/facebook.ts`     | `facebook/page.ts`, `facebook/group.ts`, `facebook/photos.ts`, `facebook/reels.ts`, `facebook/utils.ts`                                                                                                                             | 9ee2826    |
| `src/platforms/twitter.ts`      | `twitter/api/web-api/*.ts`, `twitter/utils.ts`, `twitter/user.ts`, `twitter/home.ts`, `twitter/home-latest.ts`, `twitter/media.ts`, `twitter/likes.ts`, `twitter/list.ts`, `twitter/keyword.ts`, `twitter/tweet.ts`, `twitter/spaces.ts`, `twitter/trends.ts`                   | 9ee2826    |

Things that break most often upstream and are worth checking first: Instagram `docIds`, Facebook `doc_id`s, Twitter query ids (fetched live, fallbacks in `fallbackIds`) and features, Threads page shape.

Not ported on purpose: the display options of `:routeParams` (`showAuthorInTitle`, `showAuthorAvatarInDesc`, ...), `/twitter/tweet/.../:original?` (only meaningful for RSSHub's package mode), the `:embed` flag of the YouTube routes (items link to the video with its thumbnail instead of an iframe), and RSSHub's use of the Google API key (`YOUTUBE_KEY`): socialgate reads YouTube through the same web client as RSSHub's fallback, and uses the OAuth token for subscriptions only.
`/twitter/likes` has no query id in RSSHub, the fallback in `fallbackIds` is the last one seen and is replaced by the live list like the others.
