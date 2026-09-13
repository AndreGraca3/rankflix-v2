import { useEffect, useRef, useState } from "react";

/**
 * Client-side infinite-load pagination: reveals `items` in chunks of `pageSize`,
 * loading more automatically when a sentinel element (attach `sentinelRef` to it)
 * scrolls into view. Pass a `resetKey` that changes whenever the underlying list's
 * filter/sort/search changes, so the visible window resets to the first page.
 */
export function useInfiniteList<T>(items: T[], resetKey: unknown, pageSize = 30) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => Math.min(c + pageSize, items.length));
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length, pageSize]);

  return {
    visibleItems: items.slice(0, visibleCount),
    sentinelRef,
    hasMore: visibleCount < items.length,
  };
}
