import { parseFeedQuery } from "../video-input.ts";
import { readPublicData } from "./public-data.ts";

type FeedQuery = NonNullable<ReturnType<typeof parseFeedQuery>>;
/** Bounded variants only. Searches, cursors, small pages and private feeds never create cache entries. */
export function publicFeedCacheKey(query: FeedQuery) {
  if (query.mine || query.q || query.cursor || query.limit !== 5) return null;
  return `feed:${query.sort}:${query.period}:${query.source}`;
}
export function readFeed<T>(query: FeedQuery, load: () => Promise<T>) {
  const key = publicFeedCacheKey(query);
  return key ? readPublicData(key, load) : load();
}
