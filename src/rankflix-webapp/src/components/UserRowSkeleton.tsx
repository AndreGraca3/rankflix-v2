import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/** Placeholder shown in place of a users-table row while the users list is loading. */
export function UserRowSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--surface)" highlightColor="var(--bg-elevated)">
      <tr className="users-row-skeleton">
        <td>
          <Skeleton circle width={28} height={28} />
        </td>
        <td>
          <Skeleton width="60%" />
        </td>
        <td>
          <Skeleton width="50%" />
        </td>
        <td>
          <Skeleton width={50} />
        </td>
      </tr>
    </SkeletonTheme>
  );
}
