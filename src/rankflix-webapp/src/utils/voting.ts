import type { GroupMedia } from "../api/types";

export type VotingStatus = "open" | "closing-soon" | "closed";

const CLOSING_SOON_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

/** Green while there's plenty of time left, yellow when close to closing, red once closed. */
export function getVotingStatus(media: Pick<GroupMedia, "votingOpen" | "votingClosesAt">): VotingStatus {
  if (!media.votingOpen) return "closed";
  const remainingMs = new Date(media.votingClosesAt).getTime() - Date.now();
  if (remainingMs <= CLOSING_SOON_THRESHOLD_MS) return "closing-soon";
  return "open";
}

export function votingStatusLabel(status: VotingStatus): string {
  switch (status) {
    case "open":
      return "Voting Open";
    case "closing-soon":
      return "Closing Soon";
    case "closed":
      return "Voting Closed";
  }
}
