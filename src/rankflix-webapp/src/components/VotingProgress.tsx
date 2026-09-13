import type { GroupMedia } from "../api/types";
import { VotingStatusBadge } from "./VotingStatusBadge";

const SIZE = 56;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function VotingProgress({ media }: { media: GroupMedia }) {
  const addedAt = new Date(media.addedAt).getTime();
  const closesAt = new Date(media.votingClosesAt).getTime();
  const now = Date.now();
  const total = closesAt - addedAt;
  const elapsed = now - addedAt;
  const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 100;
  const remainingMs = closesAt - now;
  const dashOffset = CIRCUMFERENCE * (1 - pct / 100);

  const remainingLabel = () => {
    if (!media.votingOpen) return "Voting closed";
    const hours = Math.floor(remainingMs / 3_600_000);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h left to vote`;
    const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
    if (hours > 0) return `${hours}h ${minutes}m left to vote`;
    return `${minutes}m left to vote`;
  };

  const remainingShort = () => {
    const hours = Math.floor(remainingMs / 3_600_000);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
    return `${minutes}m`;
  };

  return (
    <div className="voting-progress-header">
      {media.votingOpen && (
        <div className="voting-progress-ring-wrap" title={remainingLabel()}>
          <svg className="voting-progress-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <circle
              className="voting-progress-ring-track"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              fill="none"
            />
            <circle
              className="voting-progress-ring-fill"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </svg>
          <span className="voting-progress-ring-label">{remainingShort()}</span>
        </div>
      )}
      <div className="voting-progress-text">
        <VotingStatusBadge media={media} />
      </div>
    </div>
  );
}
