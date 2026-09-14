import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/** Placeholder shown in place of the "Your stats" card while /api/users/me/stats is loading. */
export function StatsCardSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--surface)" highlightColor="var(--bg-elevated)">
      <div className="card stats-card">
        <h2>Your stats</h2>
        <div className="stats-grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="stat-tile" key={i}>
              <Skeleton width={36} height={22} />
              <Skeleton width="70%" height={12} style={{ marginTop: 2 }} />
            </div>
          ))}
        </div>
        <div className="stats-top-rated">
          <Skeleton width={44} height={66} borderRadius={6} />
          <div style={{ flex: 1 }}>
            <Skeleton width="40%" height={12} />
            <Skeleton width="80%" height={16} style={{ marginTop: 6 }} />
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}
