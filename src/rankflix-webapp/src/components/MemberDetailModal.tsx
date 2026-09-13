import { useState } from "react";
import { Avatar } from "./Avatar";
import { useScrollLock } from "../hooks/useScrollLock";
import { formatWatchTime } from "../utils/time";

interface MemberModalStats {
  moviesWatched: number;
  tvWatched: number;
  totalRatingsGiven: number;
  averageRatingGiven: number | null;
  watchTimeMinutes: number;
}

interface MemberDetailModalProps {
  kind: "real" | "pending";
  name: string;
  avatarUrl?: string | null;
  isOwner?: boolean;
  online?: boolean;
  discordId: string | null;
  canManage: boolean;
  userId?: number;
  isSelf?: boolean;
  stats: MemberModalStats | undefined;
  onClose: () => void;
  onToggleOwnership?: (userId: number, makeOwner: boolean) => void;
}

export function MemberDetailModal({
  kind,
  name,
  avatarUrl,
  isOwner,
  online,
  discordId,
  canManage,
  userId,
  isSelf,
  stats,
  onClose,
  onToggleOwnership,
}: MemberDetailModalProps) {
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState(false);

  useScrollLock();

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
  };

  const copyDiscordId = async () => {
    if (!discordId) return;
    try {
      await navigator.clipboard.writeText(discordId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable, ignore */
    }
  };

  return (
    <div className={`media-modal-overlay${closing ? " closing" : ""}`} onClick={requestClose}>
      <div
        className={`media-modal member-modal${closing ? " closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => {
          if (closing) onClose();
        }}
      >
        <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
          ×
        </button>

        <div className="member-modal-header">
          {kind === "real" ? (
            <Avatar username={name} avatarUrl={avatarUrl ?? null} size={64} online={online} />
          ) : (
            <div className="avatar avatar-pending" style={{ width: 64, height: 64, fontSize: 24 }}>
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h2>
              {name}
              {isOwner && <span className="member-owner-badge" title="Owner">👑</span>}
              {kind === "pending" && <span className="member-pending-badge">Pending</span>}
            </h2>
            {kind === "real" && (
              <p className={`muted member-modal-presence${online ? " online" : ""}`}>
                {online ? "● Online" : "○ Offline"}
              </p>
            )}
            {canManage && (
              <p className="muted member-modal-discord">
                Discord ID: {discordId ?? <em>not set</em>}
                {discordId && (
                  <button
                    type="button"
                    className="member-modal-copy-btn"
                    title="Copy Discord ID"
                    onClick={copyDiscordId}
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                )}
              </p>
            )}
          </div>
        </div>

        {kind === "pending" && (
          <p className="muted">
            No account has claimed this Discord ID yet. Create their account and set this Discord ID to attach
            this history.
          </p>
        )}

        {kind === "real" && canManage && !isSelf && userId != null && onToggleOwnership && (
          <button
            type="button"
            className="btn-secondary member-modal-ownership-btn"
            onClick={() => onToggleOwnership(userId, !isOwner)}
          >
            {isOwner ? "Remove ownership" : "Make owner"}
          </button>
        )}

        <div className="member-modal-stats">
          <div className="member-modal-stat">
            <span className="member-modal-stat-value">{stats ? stats.moviesWatched + stats.tvWatched : 0}</span>
            <span className="member-modal-stat-label">Watched</span>
          </div>
          <div className="member-modal-stat">
            <span className="member-modal-stat-value">{stats?.moviesWatched ?? 0}</span>
            <span className="member-modal-stat-label">Movies</span>
          </div>
          <div className="member-modal-stat">
            <span className="member-modal-stat-value">{stats?.tvWatched ?? 0}</span>
            <span className="member-modal-stat-label">Shows</span>
          </div>
          <div className="member-modal-stat">
            <span className="member-modal-stat-value">{stats?.totalRatingsGiven ?? 0}</span>
            <span className="member-modal-stat-label">Ratings given</span>
          </div>
          <div className="member-modal-stat">
            <span className="member-modal-stat-value">
              {stats?.averageRatingGiven != null ? `★ ${stats.averageRatingGiven.toFixed(1)}` : "—"}
            </span>
            <span className="member-modal-stat-label">Avg rating</span>
          </div>
          <div className="member-modal-stat">
            <span className="member-modal-stat-value">
              {stats && stats.watchTimeMinutes > 0 ? formatWatchTime(stats.watchTimeMinutes) : "—"}
            </span>
            <span className="member-modal-stat-label">Watch time</span>
          </div>
        </div>
      </div>
    </div>
  );
}
