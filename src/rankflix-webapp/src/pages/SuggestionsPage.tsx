import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Clapperboard, Dices, Lock, LockOpen, Plus, X, Popcorn } from "lucide-react";
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
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

// Slot-machine-reel random picker tuning. The reel is a long strip of poster cards that
// scrolls under a fixed center pointer and decelerates to a stop on the winner. The card
// pitch (width + gap) is fixed in CSS so the JS translateX math matches the rendered DOM;
// the viewport's own width is measured at spin time so it still works at any screen size.
const CARD_WIDTH = 104;
const CARD_GAP = 14;
const REEL_REPEATS = 6;

function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Builds the long scrolling strip: a shuffled copy of every suggestion, repeated REEL_REPEATS
// times, with the winner appended once at the very end. No two adjacent cards are ever the
// same title:
// - Each repeat is a full shuffle (every suggestion appears exactly once per repeat), so
//   duplicates can only happen at the *seam* between two repeats, or between the last repeat
//   and the appended winner - both are checked/retried for below.
// - With exactly 2 suggestions, avoiding adjacent repeats mathematically forces strict
//   alternation (there's no other valid arrangement), so that case is built directly rather
//   than shuffled-and-patched.
function buildReel<T extends { id: string }>(items: T[], winner: T): T[] {
  if (items.length <= 1) {
    const reel = Array.from({ length: REEL_REPEATS }, () => items[0] ?? winner);
    reel.push(winner);
    return reel;
  }

  if (items.length === 2) {
    const other = items[0].id === winner.id ? items[1] : items[0];
    const totalBeforeWinner = REEL_REPEATS * items.length;
    const reel: T[] = [];
    // Starting on the winner and strictly alternating, an even-length run always ends on
    // `other` - so the winner card appended right after it is guaranteed safe too.
    for (let i = 0; i < totalBeforeWinner; i++) reel.push(i % 2 === 0 ? winner : other);
    reel.push(winner);
    return reel;
  }

  const reel: T[] = [];
  for (let i = 0; i < REEL_REPEATS; i++) {
    const isLastChunk = i === REEL_REPEATS - 1;
    let chunk = shuffled(items);
    // Reshuffle (rather than patch) up to a few times so the chunk satisfies both constraints
    // - front-seam and (for the last chunk) not ending on the winner - without disturbing
    // anything already placed in the reel.
    for (let attempt = 0; attempt < 30; attempt++) {
      const frontOk = reel.length === 0 || chunk[0].id !== reel[reel.length - 1].id;
      const tailOk = !isLastChunk || chunk[chunk.length - 1].id !== winner.id;
      if (frontOk && tailOk) break;
      chunk = shuffled(items);
    }
    // Deterministic fallback for the front-seam (guaranteed to work: chunk[0] and chunk[1] are
    // always different titles, so if chunk[0] matches the reel's last title, chunk[1] can't).
    if (reel.length > 0 && chunk[0].id === reel[reel.length - 1].id) {
      [chunk[0], chunk[1]] = [chunk[1], chunk[0]];
    }
    reel.push(...chunk);
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
    if (!canSpin || !spinsAllowedForMe || spinning || spinRequested) return;
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

  const toggleSpinsDisabled = async () => {
    if (!group) return;
    const next = !group.spinsDisabledForMembers;
    setGroup({ ...group, spinsDisabledForMembers: next });
    try {
      await api.patch(`/api/groups/${groupId}`, { spinsDisabledForMembers: next });
    } catch (e) {
      setGroup((prev) => (prev ? { ...prev, spinsDisabledForMembers: !next } : prev));
      setError(e instanceof Error ? e.message : "Failed to update spin setting");
    }
  };

  const canSpin = suggestions.length > 0;
  const spinsAllowedForMe = isGroupOwner || !group?.spinsDisabledForMembers;

  const modalPreview = useMemo(() => {
    if (!newPick) return null;
    return (
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-3">
        {newPick.posterUrl ? (
          <img src={newPick.posterUrl} alt="" className="my-1 h-[150px] w-[100px] rounded-lg object-cover" />
        ) : (
          <div className="my-0 flex h-[150px] w-[100px] items-center justify-center rounded-lg bg-muted text-2xl">
            <Clapperboard size={20} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <strong>{newPick.title}</strong>
          <span className="text-[13px] text-muted-foreground">
            {newPick.type === "tv" ? "TV Series" : "Movie"}
            {newPick.year ? ` · ${newPick.year}` : ""}
          </span>
          {newPick.genre && <span className="text-[13px] text-muted-foreground">{newPick.genre}</span>}
        </div>
      </div>
    );
  }, [newPick]);

  if (loading) return <Spinner full />;

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-[1200px] px-6 py-8 pb-16">
        <div className="mb-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            {group?.imageUrl ? (
              <img className="h-[128px] w-[128px] flex-shrink-0 rounded-lg border border-border object-cover shadow-lg" src={group.imageUrl} alt={group.name} />
            ) : (
              <div className="flex h-[128px] w-[128px] flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-lg">
                <img src="/favicon.svg" alt="" className="h-1/2 w-1/2" />
              </div>
            )}
            <h1>{group?.name} · Suggestions</h1>
          </div>
          <div className="my-3 flex flex-wrap items-center gap-2">
            <Button type="button" className="flex-shrink-0 whitespace-nowrap transition-transform hover:scale-[1.06]" onClick={() => setShowAddModal(true)}>
              + Suggest a title
            </Button>
          </div>
        </div>

        {error && (
          <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />
        )}

        <section className="my-4 rounded-lg border border-border bg-muted p-5 shadow-lg">
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="m-0 text-lg">
              <Dices size={18} className="mr-1 inline-block align-[-3px]" /> Random Pick
            </h2>
            {isGroupOwner && (
              <button
                type="button"
                className={cn(
                  "flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground hover:border-primary hover:text-primary",
                  group?.spinsDisabledForMembers && "border-destructive text-destructive hover:border-destructive hover:text-destructive"
                )}
                onClick={toggleSpinsDisabled}
                title={
                  group?.spinsDisabledForMembers
                    ? "Spins are disabled for members - click to allow"
                    : "Spins are allowed for members - click to disable"
                }
              >
                {group?.spinsDisabledForMembers ? <Lock size={15} /> : <LockOpen size={15} />}
              </button>
            )}
          </div>

          {!canSpin ? (
            <p className="text-[13px] text-muted-foreground">Add a few suggestions first, then spin to let fate decide.</p>
          ) : (
            <>
              {!spinsAllowedForMe && <p className="text-[13px] text-muted-foreground">Only the group owner can trigger a spin right now.</p>}
              <div
                className="relative mx-auto h-[132px] w-full max-w-[600px] overflow-hidden rounded-xl border border-border/70 bg-card [mask-image:linear-gradient(90deg,transparent_0,#000_12%,#000_88%,transparent_100%)]"
                ref={reelViewportRef}
              >
                <div
                  className="absolute inset-y-0 left-1/2 z-[5] w-0.5 -translate-x-1/2 bg-primary shadow-[0_0_8px_var(--primary)] before:absolute before:-top-px before:left-1/2 before:-translate-x-1/2 before:border-x-[7px] before:border-x-transparent before:border-t-[8px] before:border-t-primary before:content-['']"
                  aria-hidden="true"
                />
                <div
                  className="flex h-full items-center gap-3.5 p-0 will-change-transform"
                  style={{
                    transform: `translateX(${offset}px)`,
                    transition: animate ? "transform 4.2s cubic-bezier(0.1, 0.7, 0.15, 1)" : "none",
                  }}
                >
                  {reel.length === 0
                    ? suggestions.slice(0, 5).map((s) => (
                        <div className="h-[104px] w-[104px] flex-shrink-0 overflow-hidden rounded-lg border-2 border-transparent bg-muted" key={s.id}>
                          {s.posterUrl ? (
                            <img src={s.posterUrl} alt="" className="size-full object-cover" />
                          ) : (
                            <div className="size-full bg-card" />
                          )}
                        </div>
                      ))
                    : reel.map((s, i) => (
                        <div
                          className={cn(
                            "h-[104px] w-[104px] flex-shrink-0 overflow-hidden rounded-lg border-2 border-transparent bg-muted",
                            !spinning && i === reel.length - 1 && "border-primary shadow-[0_0_16px_color-mix(in_srgb,var(--primary)_60%,transparent)]"
                          )}
                          key={`${s.id}-${i}`}
                        >
                          {s.posterUrl ? (
                            <img src={s.posterUrl} alt="" className="size-full object-cover" />
                          ) : (
                            <div className="size-full bg-card" />
                          )}
                        </div>
                      ))}
                </div>
              </div>
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  className="min-w-[140px] rounded-full font-semibold"
                  onClick={requestSpin}
                  disabled={!canSpin || !spinsAllowedForMe || spinning || spinRequested}
                >
                  {spinning ? "Spinning…" : spinRequested ? "Starting…" : "Spin"}
                </Button>
              </div>
            </>
          )}

          {winner && !spinning && (
            <div className="mt-4 animate-[dropdown-pop-in_0.2s_ease_both] rounded-lg border border-border/70 bg-card p-3.5">
              <p className="mb-2.5 text-base">
                <Clapperboard size={16} className="mr-1 inline-block align-[-3px]" />
                <strong>{winner.title}</strong> {winner.year ? `(${winner.year})` : ""}
              </p>
              <div className="my-3 flex flex-wrap items-center gap-2">
                {isGroupOwner && (
                  <Button type="button" onClick={() => setPendingPromote(winner)}>
                    Add to group
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPendingRemove(winner);
                  }}
                >
                  Remove from suggestions
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="my-4 mb-10">
          <h2 className="m-0 mb-3 text-lg">Suggested titles</h2>
          {suggestions.length === 0 ? (
            <EmptyState icon={<Popcorn size={40} />} title="No suggestions yet" subtitle="Add a movie or show you'd like the group to watch next." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-center gap-4 rounded-lg border border-border bg-muted px-4 py-3">
                  {s.posterUrl ? (
                    <img className="h-[84px] w-14 flex-shrink-0 rounded-md object-cover" src={s.posterUrl} alt={s.title} />
                  ) : (
                    <div className="flex h-[84px] w-14 flex-shrink-0 items-center justify-center rounded-md bg-card">
                      <img src="/favicon.svg" alt="" className="h-2/5 w-2/5 opacity-40" />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">
                      {s.title}
                      {s.year ? <span className="font-normal text-muted-foreground"> ({s.year})</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-0 text-[13px] text-muted-foreground">
                      <span className="mr-1.5 rounded-full border border-border/70 bg-card px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                        {s.type}
                      </span>
                      {s.runtimeMinutes ? <span>{formatWatchTime(s.runtimeMinutes)}</span> : null}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Avatar name={s.addedByDisplayName} avatarUrl={s.addedByAvatarUrl} size={18} />
                      Suggested by {s.addedByDisplayName}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {isGroupOwner && (
                      <button
                        type="button"
                        className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground hover:border-primary hover:text-primary"
                        title="Add to group"
                        onClick={() => setPendingPromote(s)}
                      >
                        <Plus size={16} />
                      </button>
                    )}
                    {s.canRemove && (
                      <button
                        type="button"
                        className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground hover:border-destructive hover:text-destructive"
                        title="Remove"
                        onClick={() => setPendingRemove(s)}
                      >
                        <X size={16} />
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
                <X size={18} />
              </button>
              <h2>Suggest a title</h2>
              <div className="flex max-w-[480px] flex-col gap-2.5">
                <div className="flex items-start gap-2">
                  <MediaAutocomplete onSelect={setNewPick} />
                </div>
                {modalPreview}
                <div className="my-3 flex flex-wrap items-center gap-2">
                  <Button onClick={addSuggestion} disabled={!newPick || adding}>
                    {adding ? "Adding…" : "Add suggestion"}
                  </Button>
                  <Button variant="outline" onClick={requestClose}>
                    Cancel
                  </Button>
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
              <p className="text-[13px] text-muted-foreground">This just removes it from the suggestions queue, not any group history.</p>
              <div className="my-3 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => {
                    removeSuggestion(pendingRemove);
                    requestClose();
                  }}
                >
                  Remove
                </Button>
                <Button variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
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
              <p className="text-[13px] text-muted-foreground">This moves it out of suggestions and into the group's votable media list.</p>
              <div className="my-3 flex flex-wrap items-center gap-2">
                <Button
                  disabled={promoting}
                  onClick={async () => {
                    await promoteSuggestion(pendingPromote);
                    requestClose();
                  }}
                >
                  {promoting ? "Adding…" : "Add to group"}
                </Button>
                <Button variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {successToast && <Toast title={successToast} onClose={() => setSuccessToast(null)} />}
    </div>
  );
}
