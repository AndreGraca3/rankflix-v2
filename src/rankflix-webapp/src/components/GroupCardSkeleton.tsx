import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/** Placeholder shown in place of a group-card while the groups list is loading. */
export function GroupCardSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--surface)" highlightColor="var(--bg-elevated)">
      <div className="group-card">
        <div className="group-poster-wrap">
          <Skeleton height="100%" style={{ display: "block" }} />
        </div>
        <div className="group-card-info">
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={12} />
        </div>
      </div>
    </SkeletonTheme>
  );
}
