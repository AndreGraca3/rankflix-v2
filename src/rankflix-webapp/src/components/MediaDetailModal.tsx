import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GroupMedia } from "../api/types";
import { VotingProgress } from "./VotingProgress";
import { RatingModal } from "./RatingModal";
import { StarRating } from "./StarRating";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
import { useScrollLock } from "../hooks/useScrollLock";

interface MediaDetailModalProps {
  media: GroupMedia;
  canManage: boolean;
  isSiteAdmin: boolean;
  currentUserId: number | undefined;
  onClose: () => void;
  onSubmitRating: (rating: number, comment: string) => void;
  onUpdateVotingDuration: (hours: number) => void;
  onDelete: () => void;
  onRemoveReview: (userId: number) => void;
  onSetWatched: (userId: number, watched: boolean) => void;
  onSetWatchedPending: (discordId: string, watched: boolean) => void;
}

export function MediaDetailModal({
  media,
  canManage,
  isSiteAdmin,
  currentUserId,
  onClose,
  onSubmitRating,
  onUpdateVotingDuration,
  onDelete,
  onRemoveReview,
  onSetWatched,
  onSetWatchedPending,
}: MediaDetailModalProps) {
  const me = media.watchers.find((w) => w.userId === currentUserId);
  const watchedCount = media.watchers.filter((w) => w.hasWatched).length;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [watcherModalKey, setWatcherModalKey] = useState<string | null>(null);
  const watcherModalFor = media.watchers.find((w) => String(w.userId ?? w.discordId) === watcherModalKey) ?? null;
  const [pendingRemoveWatcher, setPendingRemoveWatcher] = useState<{
    userId: number | null;
    discordId: string | null;
    username: string;
  } | null>(null);
  const [pendingRemoveReview, setPendingRemoveReview] = useState<{ userId: number; username: string } | null>(null);
  const [addWatcherOpen, setAddWatcherOpen] = useState(false);
  const addWatcherRef = useRef<HTMLDivElement>(null);
  const addWatcherTriggerRef = useRef<HTMLButtonElement>(null);
  const [addWatcherPos, setAddWatcherPos] = useState({ top: 0, left: 0 });
  const notWatchedMembers = media.watchers.filter((w) => !w.hasWatched && (w.userId !== null || w.discordId));
  const [votingHoursDraft, setVotingHoursDraft] = useState(media.votingDurationHours);

  useEffect(() => {
    setVotingHoursDraft(media.votingDurationHours);
  }, [media.votingDurationHours]);

  useScrollLock();

  useEffect(() => {
    if (!addWatcherOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        addWatcherRef.current &&
        !addWatcherRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest(".watcher-add-list")
      )
        setAddWatcherOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [addWatcherOpen]);

  useLayoutEffect(() => {
    if (!addWatcherOpen || !addWatcherTriggerRef.current) return;
    const updatePos = () => {
      const rect = addWatcherTriggerRef.current!.getBoundingClientRect();
      setAddWatcherPos({ top: rect.bottom + 6, left: rect.right });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [addWatcherOpen]);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
  };

  return (
    <div className={`media-modal-overlay${closing ? " closing" : ""}`} onClick={requestClose}>
      <div
        className={`media-modal${closing ? " closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => {
          if (closing) onClose();
        }}
      >
        <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
          ×
        </button>
        <div className="media-modal-body">
          <div className="media-modal-poster-wrap">
            {media.posterUrl ? (
              <img className="media-modal-poster" src={media.posterUrl} alt={media.title} />
            ) : (
              <div className="media-modal-poster media-poster-fallback">
                <img src="/favicon.svg" alt="" />
              </div>
            )}
          </div>

          <div className="media-modal-info">
            <h2>{media.title}</h2>
            <p className="muted media-modal-meta">
              <span className="media-modal-type-badge">{media.type}</span>
              <span>{new Date(media.addedAt).toLocaleDateString()}</span>
              <span>
                {watchedCount}/{media.watchers.length} watched
              </span>
            </p>

            {media.averageRating !== null && (
              <div className="media-modal-avg-rating">
                <StarRating value={media.averageRating} readOnly size={24} />
                <span className="media-modal-avg-rating-value">{media.averageRating.toFixed(1)}/10</span>
                <span className="muted">average rating</span>
              </div>
            )}

            <VotingProgress media={media} />

            {me?.hasWatched && media.votingOpen && (
              <button type="button" className="media-modal-vote-cta" onClick={() => setShowRatingModal(true)}>
                {me.rating !== null ? (
                  <>
                    <StarRating value={me.rating} readOnly size={18} />
                    <span>Your rating: {me.rating}/10</span>
                    <span className="media-modal-vote-cta-edit">Edit</span>
                  </>
                ) : (
                  <span>⭐ Rate this now</span>
                )}
              </button>
            )}

            <div className="media-modal-section">
              <div className="media-modal-section-header">
                <h3 className="media-modal-section-title">Watchers</h3>
                {canManage && media.votingOpen && (
                  <div className="watcher-add-dropdown" ref={addWatcherRef}>
                    <button
                      type="button"
                      ref={addWatcherTriggerRef}
                      className="watcher-add-trigger"
                      onClick={() => setAddWatcherOpen((o) => !o)}
                    >
                      + Add watcher
                    </button>
                    {addWatcherOpen &&
                      createPortal(
                        <ul
                          className="watcher-add-list watcher-add-list-portal"
                          style={{ top: addWatcherPos.top, left: addWatcherPos.left }}
                        >
                          {notWatchedMembers.length === 0 && (
                            <li className="watcher-add-empty muted">Everyone has watched</li>
                          )}
                          {notWatchedMembers.map((w) => (
                            <li
                              key={w.userId ?? w.discordId}
                              onClick={() => {
                                if (w.userId !== null) onSetWatched(w.userId, true);
                                else onSetWatchedPending(w.discordId!, true);
                                setAddWatcherOpen(false);
                              }}
                            >
                              <Avatar username={w.username} avatarUrl={w.avatarUrl} size={22} />
                              <span>{w.username}</span>
                              {w.isPending && <span className="member-pending-badge">Pending</span>}
                            </li>
                          ))}
                        </ul>,
                        document.body
                      )}
                  </div>
                )}
              </div>
              <div className="media-modal-watcher-chips">
                {media.watchers.filter((w) => w.hasWatched).length === 0 && (
                  <p className="muted">No one has watched this yet.</p>
                )}
                {media.watchers
                  .filter((w) => w.hasWatched)
                  .map((w) => {
                    const key = String(w.userId ?? w.discordId);
                    const isMe = w.userId === currentUserId;
                    const canRate = isMe && w.hasWatched && media.votingOpen;
                    const canRemove =
                      canManage && w.hasWatched && (w.userId !== null || w.discordId) && (media.votingOpen || isSiteAdmin);
                    const removeWatcher = () => {
                      setPendingRemoveWatcher({ userId: w.userId, discordId: w.discordId ?? null, username: w.username });
                    };
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`watcher-chip${w.hasWatched ? " watched" : ""}${isMe ? " is-me" : ""}`}
                        title={canRate ? (w.rating !== null ? "Edit your rating" : "Rate this") : undefined}
                        onClick={() => (canRate ? setShowRatingModal(true) : setWatcherModalKey(key))}
                      >
                        <Avatar username={w.username} avatarUrl={w.avatarUrl} size={26} />
                        <span className="watcher-chip-name">{w.username}</span>
                        {isMe && <span className="watcher-chip-you">You</span>}
                        {w.rating !== null ? (
                          <span className="watcher-chip-rating">{w.rating}</span>
                        ) : w.hasWatched ? (
                          <span className="watcher-chip-check">—</span>
                        ) : null}
                        {w.comment && (
                          <span className="watcher-chip-comment" title="Has a comment">
                            💬
                          </span>
                        )}
                        {canRemove && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="watcher-chip-remove"
                            title="Remove watcher"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeWatcher();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.stopPropagation();
                                e.preventDefault();
                                removeWatcher();
                              }
                            }}
                          >
                            ×
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>

            {canManage && (
              <div className="media-modal-admin-row">
                {media.votingOpen && (
                  <div className="muted media-modal-voting-hours">
                    <span>Voting hours</span>
                    <div className="voting-hours-stepper">
                      <button
                        type="button"
                        aria-label="Decrease voting hours"
                        onClick={() => setVotingHoursDraft((h) => Math.max(1, h - 1))}
                      >
                        −
                      </button>
                      <span className="voting-hours-value">{votingHoursDraft}</span>
                      <button
                        type="button"
                        aria-label="Increase voting hours"
                        onClick={() => setVotingHoursDraft((h) => h + 1)}
                      >
                        +
                      </button>
                    </div>
                    {votingHoursDraft !== media.votingDurationHours && (
                      <button
                        type="button"
                        className="voting-hours-save"
                        onClick={() => onUpdateVotingDuration(votingHoursDraft)}
                      >
                        Save
                      </button>
                    )}
                  </div>
                )}
                {!confirmingDelete ? (
                  <button className="danger" onClick={() => setConfirmingDelete(true)}>
                    Remove from group
                  </button>
                ) : (
                  <div className="media-modal-confirm-delete">
                    <span className="muted">Remove & delete votes/history?</span>
                    <button className="danger" onClick={onDelete}>
                      Yes, remove
                    </button>
                    <button className="secondary" onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showRatingModal && (
        <RatingModal
          title={media.title}
          posterUrl={media.posterUrl}
          initialRating={me?.rating ?? 0}
          initialComment={me?.comment ?? ""}
          onCancel={() => setShowRatingModal(false)}
          onSubmit={(rating, comment) => {
            onSubmitRating(rating, comment);
            setShowRatingModal(false);
          }}
        />
      )}

      {watcherModalFor && (
        <Modal overlayClassName="comment-modal-overlay" modalClassName="comment-modal" onClose={() => setWatcherModalKey(null)}>
          {(requestClose) => (
            <>
              <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                ×
              </button>
              <p className="comment-modal-author">
                <Avatar username={watcherModalFor.username} avatarUrl={watcherModalFor.avatarUrl} size={28} />
                {watcherModalFor.username}
                {watcherModalFor.isPending && <span className="member-pending-badge">Pending</span>}
              </p>

              {watcherModalFor.hasWatched ? (
                watcherModalFor.rating !== null ? (
                  <p className="comment-modal-rating-row">
                    <StarRating value={watcherModalFor.rating} readOnly size={20} />
                    <span className="comment-modal-rating">{watcherModalFor.rating}/10</span>
                    {canManage && watcherModalFor.userId !== null && (media.votingOpen || isSiteAdmin) && (
                      <button
                        className="media-modal-remove-review"
                        title="Remove this rating"
                        onClick={() => {
                          setPendingRemoveReview({ userId: watcherModalFor.userId!, username: watcherModalFor.username });
                          setWatcherModalKey(null);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </p>
                ) : (
                  <p className="comment-modal-rating-row">
                    <StarRating value={0} readOnly size={20} />
                    <span className="muted">Not rated yet</span>
                  </p>
                )
              ) : (
                <p className="comment-modal-rating-row">
                  <StarRating value={0} readOnly size={20} />
                  <span className="muted">Hasn't watched yet</span>
                </p>
              )}

              {watcherModalFor.rating !== null && watcherModalFor.ratedAt && (
                <p className="comment-modal-rated-at muted">
                  Voted {new Date(watcherModalFor.ratedAt).toLocaleString()}
                </p>
              )}

              {watcherModalFor.comment && <p className="comment-modal-text">{watcherModalFor.comment}</p>}

              {canManage &&
                (watcherModalFor.userId !== null || watcherModalFor.discordId) &&
                (media.votingOpen || (isSiteAdmin && watcherModalFor.hasWatched)) && (
                <button
                  type="button"
                  className={`media-modal-watcher-action${watcherModalFor.hasWatched ? " remove" : " add"}`}
                  onClick={() => {
                    if (watcherModalFor.hasWatched) {
                      setPendingRemoveWatcher({
                        userId: watcherModalFor.userId,
                        discordId: watcherModalFor.discordId ?? null,
                        username: watcherModalFor.username,
                      });
                      setWatcherModalKey(null);
                      return;
                    }
                    if (watcherModalFor.userId !== null) onSetWatched(watcherModalFor.userId, true);
                    else if (watcherModalFor.discordId) onSetWatchedPending(watcherModalFor.discordId, true);
                    setWatcherModalKey(null);
                  }}
                >
                  {watcherModalFor.hasWatched ? "Remove watcher" : "+ Add watcher"}
                </button>
              )}
            </>
          )}
        </Modal>
      )}

      {pendingRemoveWatcher && (
        <Modal
          overlayClassName="comment-modal-overlay"
          modalClassName="comment-modal confirm-modal"
          onClose={() => setPendingRemoveWatcher(null)}
        >
          {(requestClose) => (
            <>
              <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                ×
              </button>
              <p>
                Remove <strong>{pendingRemoveWatcher.username}</strong> as a watcher?
                {pendingRemoveWatcher.userId !== null || pendingRemoveWatcher.discordId ? (
                  <span className="muted"> Their rating and comment for this title will also be deleted.</span>
                ) : null}
              </p>
              <div className="media-modal-confirm-delete confirm-modal-actions">
                <button
                  className="danger"
                  onClick={() => {
                    if (pendingRemoveWatcher.userId !== null) onSetWatched(pendingRemoveWatcher.userId, false);
                    else if (pendingRemoveWatcher.discordId) onSetWatchedPending(pendingRemoveWatcher.discordId, false);
                    requestClose();
                  }}
                >
                  Yes, remove
                </button>
                <button className="secondary" onClick={requestClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {pendingRemoveReview && (
        <Modal
          overlayClassName="comment-modal-overlay"
          modalClassName="comment-modal confirm-modal"
          onClose={() => setPendingRemoveReview(null)}
        >
          {(requestClose) => (
            <>
              <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                ×
              </button>
              <p>
                Remove <strong>{pendingRemoveReview.username}</strong>&apos;s rating for this title?
              </p>
              <div className="media-modal-confirm-delete confirm-modal-actions">
                <button
                  className="danger"
                  onClick={() => {
                    onRemoveReview(pendingRemoveReview.userId);
                    requestClose();
                  }}
                >
                  Yes, remove
                </button>
                <button className="secondary" onClick={requestClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
