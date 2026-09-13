import type { RefObject } from "react";

/** Small bouncing-dots indicator shown at the bottom of an infinite-load list while more items remain. */
export function InfiniteScrollLoader({ sentinelRef }: { sentinelRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={sentinelRef} className="infinite-scroll-sentinel">
      <span className="infinite-scroll-dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
