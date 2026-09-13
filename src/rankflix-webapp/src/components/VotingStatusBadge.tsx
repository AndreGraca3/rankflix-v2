import { getVotingStatus, votingStatusLabel } from "../utils/voting";
import type { GroupMedia } from "../api/types";

export function VotingStatusBadge({
  media,
  className,
}: {
  media: Pick<GroupMedia, "votingOpen" | "votingClosesAt">;
  className?: string;
}) {
  const status = getVotingStatus(media);
  return (
    <span className={`voting-status-badge voting-status-${status}${className ? ` ${className}` : ""}`}>
      {votingStatusLabel(status)}
    </span>
  );
}
