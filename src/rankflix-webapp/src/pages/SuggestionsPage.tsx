import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Group, MediaSearchResult, Suggestion } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { MediaAutocomplete } from "../components/MediaAutocomplete";
import { Modal } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { useServerEvent } from "../hooks/useServerEvent";
import { formatWatchTime } from "../utils/time";

// Slot-machine-reel random picker tuning. The reel is a long strip of poster cards that
// scrolls under a fixed center pointer and decelerates to a stop on the winner. The card
// pitch (width + gap) is fixed in CSS so the JS translateX math matches the rendered DOM;
// the viewport's own width is measured at spin time so it still works at any screen size.
const CARD_WIDTH = 104;
const CARD_GAP = 12;
const REEL_REPEATS = 6;

function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Builds the long scrolling strip: a shuffled copy of every suggestion, repeated
// REEL_REPEATS times, with the winner appended once at the very end. Each repeat is a full
// shuffle (every suggestion appears exactly once per repeat) so the only place the same title
// could ever land right next to itself is at the seam between two repeats (or between the
// last repeat and the appended winner) - swap it out in those two spots so a title never
// visibly repeats "twice in a row" and instead only reappears further along the strip.
function buildReel<T extends { id: string }>(items: T[], winner: T): T[] {
  const reel: T[] = [];
  for (let i = 0; i < REEL_REPEATS; i++) {
    const chunk = shuffled(items);
    if (reel.length > 0 && chunk.length > 1 && chunk[0].id === reel[reel.length - 1].id) {
      [chunk[0], chunk[1]] = [chunk[1], chunk[0]];
    }
    reel.push(...chunk);
  }
  if (reel.length > 0 && reel[reel.length - 1].id === winner.id) {
    const swapWith = reel.findIndex((s) => s.id !== winner.id);
    if (swapWith !== -1) [reel[reel.length - 1], reel[swapWith]] = [reel[swapWith], reel[reel.length - 1]];
  }
  reel.push(winner);
  return reel;
}


export function SuggestionsPage() {
  const { groupId } = useParams();
  const { user, adminViewEnabled } = useAuth();
  const isAdmin = user?.role === "admin" && adminViewEnabled;

  const [group, setGroup] = useState<Group | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPick, setNewPick] = useState<MediaSearchResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Suggestion | null>(null);
  const [pendingPromote, setPendingPromote] = useState<Suggestion | null>(null);
  const [promoting, setPromoting] = useState(false);

  const isGroupOwner = isAdmin || group?.members.some((m) => m.userId === user?.id && m.isOwner) === true;

  const load = useCallback(() => {
    if (!groupId) return;
    api.get<Group>(`/api/groups/${groupId}`).then(setGroup).catch((e) => setError(e.message));
    api
      .get<Suggestion[]>(`/api/groups/${groupId}/suggestions`)
      .then(setSuggestions)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load suggestions"))
      .finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useServerEvent<{ groupId?: number }>("suggestions-changed", (payload) => {
    if (String(payload.groupId) === groupId) load();
  });

  const addSuggestion = async () => {
    if (!newPick) return;
    setAdding(true);
    try {
      await api.post(`/api/groups/${groupId}/suggestions`, {
        tmdbId: newPick.tmdbId,
        title: newPick.title,
        type: newPick.type,
        posterUrl: newPick.posterUrl,
      });
      setShowAddModal(false);
      setNewPick(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add suggestion");
    } finally {
      setAdding(false);
    }
  };

  const removeSuggestion = async (s: Suggestion) => {
    setPendingRemove(null);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    // The reel is a static snapshot built at spin time, so it doesn't know a suggestion was
    // just removed - if the removed title is showing in the wheel (as the winner or otherwise),
    // reset the reel so a stale/no-longer-available title isn't left displayed as the result.
    if (winner?.id === s.id) resetReel();
    try {
      await api.delete(`/api/groups/${groupId}/suggestions/${s.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove suggestion");
      load();
    }
  };

  const promoteSuggestion = async (s: Suggestion) => {
    setPromoting(true);
    try {
      await api.post(`/api/groups/${groupId}/suggestions/${s.id}/promote`, {});
      setPendingPromote(null);
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      setSuccessToast(`"${s.title}" added to the group's media list`);
      // Same reasoning as removeSuggestion: the promoted title is no longer a valid pick, so
      // clear the reel/winner display rather than leaving it shown as still "won".
      resetReel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to media list");
    } finally {
      setPromoting(false);
    }
  };

  // --- Random pick (reel) ---
  // The spin itself is a shared, broadcast animation: clicking "Spin" just asks the server to
  // pick a winner and tell every group member (via the "suggestion-spin" SSE event, below) -
  // the actual reel/animation only starts once that event arrives, so everyone in the group
  // (including whoever clicked) sees the exact same spin play out at the same time.
  const [spinning, setSpinning] = useState(false);
  const [spinRequested, setSpinRequested] = useState(false);
  const [winner, setWinner] = useState<Suggestion | null>(null);
  const [reel, setReel] = useState<Suggestion[]>([]);
  const [offset, setOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reelViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
  }, []);

  const resetReel = () => {
    setWinner(null);
    setReel([]);
    setOffset(0);
    setAnimate(false);
  };

  const playSpin = useCallback((winnerPick: Suggestion, poolAtSpinTime: Suggestion[]) => {
    setSpinRequested(false);
    setWinner(null);
    setSpinning(true);

    const pool = poolAtSpinTime.length > 0 ? poolAtSpinTime : [winnerPick];
    const builtReel = buildReel(pool, winnerPick);

    // Measured live (rather than a fixed constant) so this still centers correctly on any
    // screen width - the viewport shrinks to fit narrow mobile screens via CSS.
    const viewportWidth = reelViewportRef.current?.clientWidth ?? 5 * (CARD_WIDTH + CARD_GAP);
    const winnerCardCenter = (builtReel.length - 1) * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2;
    const targetOffset = viewportWidth / 2 - winnerCardCenter;

    // Snap the strip back to the start with no transition, then (next frame) enable the
    // transition and set the target offset so the browser animates the move.
    setAnimate(false);
    setReel(builtReel);
    setOffset(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setAnimate(true);
        setOffset(targetOffset);
      });
    });

    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    spinTimeoutRef.current = setTimeout(() => {
      setSpinning(false);
      setWinner(winnerPick);
    }, 4200);
  }, []);

  useServerEvent<{ groupId?: number; winnerSuggestionId?: string }>("suggestion-spin", (payload) => {
    if (String(payload.groupId) !== groupId) return;
    const winnerPick = suggestions.find((s) => s.id === payload.winnerSuggestionId);
    if (winnerPick) playSpin(winnerPick, suggestions);
  });

  const requestSpin = async () => {
    if (!canSpin || spinning || spinRequested) return;
    setSpinRequested(true);
    try {
      await api.post(`/api/groups/${groupId}/suggestions/spin`, {});
      // The animation itself starts from the "suggestion-spin" broadcast above, not here -
      // spinRequested just keeps the button disabled for the short round-trip until it arrives.
    } catch (e) {
      setSpinRequested(false);
      setError(e instanceof Error ? e.message : "Failed to start the pick");
    }
  };

  const canSpin = suggestions.length > 0;

  const modalPreview = useMemo(() => {
    if (!newPick) return null;
    return (
      <div className="suggestion-preview">
        {newPick.posterUrl ? (
          <img src={newPick.posterUrl} alt="" className="suggestion-preview-poster" />
        ) : (
          <div className="suggestion-preview-poster suggestion-preview-poster-fallback">🎬</div>
        )}
        <div className="suggestion-preview-info">
          <strong>{newPick.title}</strong>
          <span className="muted">
            {newPick.type === "tv" ? "TV Series" : "Movie"}
            {newPick.year ? ` · ${newPick.year}` : ""}
          </span>
          {newPick.genre && <span className="muted">{newPick.genre}</span>}
        </div>
      </div>
    );
  }, [newPick]);

  if (loading) return <Spinner full />;

  return (
    <div>
      <NavBar />
      <main className="page page-wide">
        <div className="page-header-row">
          <div className="group-header-title">
            {group?.imageUrl ? (
              <img className="group-header-poster" src={group.imageUrl} alt={group.name} />
            ) : (
              <div className="group-header-poster group-poster-fallback">
                <img src="/favicon.svg" alt="" />
              </div>
            )}
            <h1>{group?.name} · Suggestions</h1>
          </div>
          <div className="row">
            <button type="button" className="media-toolbar-add-btn" onClick={() => setShowAddModal(true)}>
              + Suggest a title
            </button>
          </div>
        </div>

        {error && (
          <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />
        )}

        <section className="random-pick-section">
          <div className="random-pick-header">
            <h2>🎲 Random Pick</h2>
            <button type="button" className="spin-btn" onClick={requestSpin} disabled={!canSpin || spinning || spinRequested}>
              {spinning ? "Spinning…" : spinRequested ? "Starting…" : "Spin"}
            </button>
          </div>

          {!canSpin ? (
            <p className="muted">Add a few suggestions first, then spin to let fate decide.</p>
          ) : (
            <div className="reel-viewport" ref={reelViewportRef}>
              <div className="reel-pointer" aria-hidden="true" />
              <div
                className="reel-track"
                style={{
                  transform: `translateX(${offset}px)`,
                  transition: animate ? "transform 4.2s cubic-bezier(0.1, 0.7, 0.15, 1)" : "none",
                }}
              >
                {reel.length === 0
                  ? suggestions.slice(0, 5).map((s) => (
                      <div className="reel-card" key={s.id}>
                        {s.posterUrl ? <img src={s.posterUrl} alt="" /> : <div className="reel-card-placeholder" />}
                      </div>
                    ))
                  : reel.map((s, i) => (
                      <div className={`reel-card${!spinning && i === reel.length - 1 ? " reel-card-winner" : ""}`} key={`${s.id}-${i}`}>
                        {s.posterUrl ? <img src={s.posterUrl} alt="" /> : <div className="reel-card-placeholder" />}
                      </div>
                    ))}
              </div>
            </div>
          )}

          {winner && !spinning && (
            <div className="spin-winner-panel">
              <p>
                🎬 <strong>{winner.title}</strong> {winner.year ? `(${winner.year})` : ""}
              </p>
              <div className="row">
                {isGroupOwner && (
                  <button type="button" onClick={() => setPendingPromote(winner)}>
                    Add to group
                  </button>
                )}
                <button type="button" className="secondary" onClick={requestSpin} disabled={spinRequested}>
                  Spin again
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPendingRemove(winner);
                  }}
                >
                  Remove from suggestions
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="suggestions-list-section">
          <h2>Suggested titles</h2>
          {suggestions.length === 0 ? (
            <EmptyState icon="🍿" title="No suggestions yet" subtitle="Add a movie or show you'd like the group to watch next." />
          ) : (
            <ul className="suggestions-list">
              {suggestions.map((s) => (
                <li key={s.id} className="suggestion-card">
                  {s.posterUrl ? (
                    <img className="suggestion-card-poster" src={s.posterUrl} alt={s.title} />
                  ) : (
                    <div className="suggestion-card-poster media-poster-fallback">
                      <img src="/favicon.svg" alt="" />
                    </div>
                  )}
                  <div className="suggestion-card-info">
                    <span className="media-card-title">
                      {s.title}
                      {s.year ? <span className="media-modal-year"> ({s.year})</span> : null}
                    </span>
                    <span className="media-ranking-meta muted">
                      <span className="media-modal-type-badge">{s.type}</span>
                      {s.runtimeMinutes ? <span className="media-ranking-meta-item">{formatWatchTime(s.runtimeMinutes)}</span> : null}
                    </span>
                    <span className="suggestion-card-added-by muted">
                      <Avatar name={s.addedByDisplayName} avatarUrl={s.addedByAvatarUrl} size={18} />
                      Suggested by {s.addedByDisplayName}
                    </span>
                  </div>
                  <div className="suggestion-card-actions">
                    {isGroupOwner && (
                      <button type="button" className="suggestion-promote-btn" title="Add to group" onClick={() => setPendingPromote(s)}>
                        ➕
                      </button>
                    )}
                    {s.canRemove && (
                      <button type="button" className="suggestion-remove-btn" title="Remove" onClick={() => setPendingRemove(s)}>
                        ×
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {showAddModal && (
        <Modal
          modalClassName="media-modal add-media-modal"
          onClose={() => {
            setShowAddModal(false);
            setNewPick(null);
          }}
        >
          {(requestClose) => (
            <>
              <button className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                ×
              </button>
              <h2>Suggest a title</h2>
              <div className="add-media-form">
                <div className="add-media-search-row">
                  <MediaAutocomplete onSelect={setNewPick} />
                </div>
                {modalPreview}
                <div className="row">
                  <button onClick={addSuggestion} disabled={!newPick || adding}>
                    {adding ? "Adding…" : "Add suggestion"}
                  </button>
                  <button className="secondary" onClick={requestClose}>
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {pendingRemove && (
        <Modal modalClassName="media-modal confirm-modal" onClose={() => setPendingRemove(null)}>
          {(requestClose) => (
            <>
              <h2>Remove "{pendingRemove.title}"?</h2>
              <p className="muted">This just removes it from the suggestions queue, not any group history.</p>
              <div className="row">
                <button
                  onClick={() => {
                    removeSuggestion(pendingRemove);
                    requestClose();
                  }}
                >
                  Remove
                </button>
                <button className="secondary" onClick={requestClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {pendingPromote && (
        <Modal modalClassName="media-modal confirm-modal" onClose={() => setPendingPromote(null)}>
          {(requestClose) => (
            <>
              <h2>Add "{pendingPromote.title}" to the group?</h2>
              <p className="muted">This moves it out of suggestions and into the group's votable media list.</p>
              <div className="row">
                <button
                  disabled={promoting}
                  onClick={async () => {
                    await promoteSuggestion(pendingPromote);
                    requestClose();
                  }}
                >
                  {promoting ? "Adding…" : "Add to group"}
                </button>
                <button className="secondary" onClick={requestClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {successToast && <Toast title={successToast} onClose={() => setSuccessToast(null)} />}
    </div>
  );
}
