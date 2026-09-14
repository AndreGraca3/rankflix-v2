import { useEffect, useState } from "react";
import { useInfiniteScroll } from "react-infinite-scroll-component";

/**
 * Client-side infinite-load pagination: reveals `items` in chunks of `pageSize`, loading more
 * automatically when a sentinel element (attach `sentinelRef` to it) scrolls into view. Uses
 * react-infinite-scroll-component's IntersectionObserver-based hook under the hood instead of a
 * hand-rolled one, for more robust cross-browser behavior. Pass a `resetKey` that changes
 * whenever the underlying list's filter/sort/search changes, so the visible window resets to the
 * first page.
 */
export function useInfiniteList<T>(items: T[], resetKey: unknown, pageSize = 30) {
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setVisibleCount(pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, pageSize]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  const { sentinelRef } = useInfiniteScroll({
    next: () => setVisibleCount((c) => Math.min(c + pageSize, items.length)),
    hasMore,
    dataLength: visibleItems.length,
    scrollThreshold: "300px",
  });

  return { visibleItems, sentinelRef, hasMore };
}
