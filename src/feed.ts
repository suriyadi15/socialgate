export type Item = {
    /** Unique link of the item, used as id. */
    url: string;
    title: string;
    contentHtml: string;
    /** Date or ISO string. */
    published?: Date;
    author?: string;
    tags?: string[];
    image?: string;
    attachments?: Array<{ url: string; mimeType: string; durationInSeconds?: number }>;
};

export type Feed = {
    title: string;
    url: string;
    description?: string;
    icon?: string;
    items: Item[];
};

const compact = <T extends object>(object: T): T => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))) as T;

/** JSON Feed 1.1, https://jsonfeed.org/version/1.1 */
export const toJsonFeed = (feed: Feed, limit?: number) => ({
    ...compact({
        version: 'https://jsonfeed.org/version/1.1',
        title: feed.title,
        home_page_url: feed.url,
        description: feed.description,
        icon: feed.icon,
    }),
    // `items` is required by JSON Feed: an empty timeline is `[]`, not a missing key (compact would drop it)
    items: (limit ? feed.items.slice(0, limit) : feed.items).map((item) =>
            compact({
                id: item.url,
                url: item.url,
                title: item.title,
                content_html: item.contentHtml,
                date_published: item.published?.toISOString(),
                authors: item.author ? [{ name: item.author }] : undefined,
                tags: item.tags,
                image: item.image,
                attachments: item.attachments?.map((a) =>
                    compact({
                        url: a.url,
                        mime_type: a.mimeType,
                        duration_in_seconds: a.durationInSeconds,
                    })
                ),
            })
    ),
});
