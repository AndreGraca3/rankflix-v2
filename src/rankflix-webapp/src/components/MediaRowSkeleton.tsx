import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/**
 * Placeholder shown in place of a media-ranking-row while the group's media list is still
 * loading, instead of briefly flashing the "no media yet" empty state.
 */
export function MediaRowSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--surface)" highlightColor="var(--bg-elevated)">
      <div className="media-ranking-row media-ranking-row-skeleton">
        <span className="media-ranking-number">
          <Skeleton width={20} />
        </span>
        <div className="media-ranking-poster-wrap">
          <Skeleton width={44} height={66} borderRadius={6} />
        </div>
        <div className="media-ranking-info">
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" height={12} style={{ marginTop: 6 }} />
        </div>
        <span className="media-ranking-score">
          <Skeleton width={36} />
        </span>
      </div>
    </SkeletonTheme>
  );
}
