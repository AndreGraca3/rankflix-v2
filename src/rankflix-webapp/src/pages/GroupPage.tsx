import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import confetti from "canvas-confetti";
import { api } from "../api/client";
import type { ExcelImportResult, Group, GroupMedia, GroupStats, MediaSearchResult, PagedGroupMedia, UserDirectoryItem } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { MediaAutocomplete } from "../components/MediaAutocomplete";
import { MediaDetailModal } from "../components/MediaDetailModal";
import { MemberDetailModal } from "../components/MemberDetailModal";
import { AddMemberDropdown } from "../components/AddMemberDropdown";
import { RankingMemberSelect } from "../components/RankingMemberSelect";
import { FilterPopover } from "../components/FilterPopover";
import { VotingStatusBadge } from "../components/VotingStatusBadge";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { GroupEditForm } from "../components/GroupEditor";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { EmptyState } from "../components/EmptyState";
import { MediaRowSkeleton } from "../components/MediaRowSkeleton";
import { Modal } from "../components/Modal";
import { useAuth } from "../auth/AuthContext";
import { usePresence } from "../presence/PresenceContext";
import { useServerEvent } from "../hooks/useServerEvent";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { formatWatchTime } from "../utils/time";

const MEDIA_PAGE_SIZE = 30;

export function GroupPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, adminViewEnabled } = useAuth();
  const { isOnline } = usePresence();
  const isAdmin = user?.role === "admin" && adminViewEnabled;
  const [group, setGroup] = useState<Group | null>(null);
  const [media, setMedia] = useState<GroupMedia[]>([]);
  // Kept in sync with `media` via effect below so async callbacks (SSE patches, post-save
  // resyncs) can read the *current* list/length without depending on a stale render's closure.
  const mediaRef = useRef<GroupMedia[]>([]);
  // Bumped by every operation that replaces the whole visible window (initial/page-1 load or a
  // ranking resync); a resync whose sequence number was superseded by a newer one before it
  // resolved is discarded instead of applied, so out-of-order responses can't clobber fresher data.
  const mediaWindowSeqRef = useRef(0);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaTotalCount, setMediaTotalCount] = useState(0);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [totalMediaInGroup, setTotalMediaInGroup] = useState(0);
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<UserDirectoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTmdbId, setSelectedTmdbId] = useState<number | null>(null);
  const [showAddMedia, setShowAddMedia] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [showDeleteGroup, setShowDeleteGroup] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [rankingMemberId, setRankingMemberId] = useState<number | string | "average">("average");
  const [votingFilter, setVotingFilter] = useState<"all" | "open" | "closed">("all");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [ratingFilter, setRatingFilter] = useState<number | "unrated" | null>(null);
  const [pendingVotesOnly, setPendingVotesOnly] = useState(false);
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
  const [memberSortMode, setMemberSortMode] = useState<"az" | "rating" | "watched">("az");
  const [membersExpanded, setMembersExpanded] = useState(false);
  const [mediaSearchInput, setMediaSearchInput] = useState("");
  const [mediaSearch, setMediaSearch] = useState("");
  const [importToast, setImportToast] = useState<ExcelImportResult | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [memberModal, setMemberModal] = useState<SidebarMember | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ kind: "member"; userId: number; label: string } | { kind: "pending"; discordId: string; label: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newMedia, setNewMedia] = useState<{
    tmdbId: string;
    title: string;
    type: string;
    posterUrl: string | null;
    votingDurationHours: string;
    watchedByUserIds: (number | string)[];
  }>({ tmdbId: "", title: "", type: "movie", posterUrl: null, votingDurationHours: "", watchedByUserIds: [] });

  const buildMediaQuery = (skip: number, take = MEDIA_PAGE_SIZE) => {
    const params = new URLSearchParams();
    params.set("skip", String(skip));
    params.set("take", String(take));
    if (mediaSearch) params.set("search", mediaSearch);
    selectedGenres.forEach((g) => params.append("genre", g));
    if (ratingFilter === "unrated") params.set("unratedOnly", "true");
    else if (ratingFilter !== null) params.set("minRating", String(ratingFilter));
    if (votingFilter !== "all") params.set("votingStatus", votingFilter);
    if (pendingVotesOnly) params.set("pendingVotesOnly", "true");
    if (rankingMemberId !== "average") params.set("rankingMember", String(rankingMemberId));
    return params.toString();
  };

  // All filtering/sorting/pagination for the media list now happens server-side (see
  // MediaService.GetGroupMediaAsync) - this just fetches one page at a time and appends
  // (skip > 0) or replaces (skip === 0) the accumulated `media` list. A page-1 (skip === 0)
  // fetch bumps `mediaWindowSeqRef` and is only applied if still the latest such request when
  // it resolves, so it can't race with (and lose to, or clobber) a concurrent ranking resync.
  const loadMedia = (skip: number, take = MEDIA_PAGE_SIZE) => {
    if (!groupId) return Promise.resolve();
    const isFirstPage = skip === 0;
    if (isFirstPage) setMediaLoading(true);
    const seq = isFirstPage ? ++mediaWindowSeqRef.current : mediaWindowSeqRef.current;
    return api
      .get<PagedGroupMedia>(`/api/groups/${groupId}/media?${buildMediaQuery(skip, take)}`)
      .then((res) => {
        if (isFirstPage && seq !== mediaWindowSeqRef.current) return;
        setMedia((cur) => (isFirstPage ? res.items : [...cur, ...res.items]));
        setMediaTotalCount(res.totalCount);
        setMediaHasMore(res.hasMore);
        setAvailableGenres(res.availableGenres);
        setTotalMediaInGroup(res.totalMediaInGroup);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load media"))
      .finally(() => {
        if (isFirstPage) setMediaLoading(false);
      });
  };

  const loadGroupAndStats = () => {
    if (!groupId) return;
    api.get<Group>(`/api/groups/${groupId}`).then(setGroup).catch((e) => setError(e.message));
    api.get<GroupStats>(`/api/groups/${groupId}/stats`).then(setGroupStats).catch(() => {});
  };

  // Used when the group's membership/media-set changes in a way the client can't patch locally
  // (import overwrite, member add/remove, new media) - resets the media list back to its first
  // page under the current filters, rather than trying to preserve however many pages were
  // scrolled into, which keeps that refresh logic simple.
  const load = () => {
    loadGroupAndStats();
    loadMedia(0, MEDIA_PAGE_SIZE);
  };

  // "Fully rated" = every watcher who's marked as having watched it has also rated it - i.e.
  // there's no one left whose vote could still change its score.
  const isFullyRated = (m: GroupMedia): boolean => {
    const watched = m.watchers.filter((w) => w.hasWatched);
    return watched.length > 0 && watched.every((w) => w.rating !== null);
  };

  const fireConfetti = () => {
    confetti({
      particleCount: 140,
      spread: 80,
      startVelocity: 45,
      origin: { y: 0.3 },
      zIndex: 3000,
    });
  };

  // Tracks the group's *true* current #1 (highest-ranked, fully-rated) item from the active
  // ranking perspective, independent of any display filter/search - so a search/genre/rating/
  // voting-status filter narrowing the visible list can never make an item merely #1-of-the-
  // filtered-subset look like a real #1 (e.g. an item that's genuinely #2 overall, but the only
  // other item matching an active filter happens to be rated lower, would otherwise wrongly look
  // like #1 within that filtered view). `rankingMemberId` is kept as the only query param here
  // since it's a legitimate ranking axis (whose ratings to sort by), not a filter that shrinks
  // the candidate pool.
  const trueTopIdRef = useRef<number | null>(null);

  const fetchTrueTopFullyRated = async (): Promise<GroupMedia | null> => {
    if (!groupId) return null;
    const params = new URLSearchParams();
    params.set("skip", "0");
    params.set("take", "1");
    if (rankingMemberId !== "average") params.set("rankingMember", String(rankingMemberId));
    const res = await api.get<PagedGroupMedia>(`/api/groups/${groupId}/media?${params.toString()}`);
    const top = res.items[0];
    return top && isFullyRated(top) ? top : null;
  };

  // Silently (re)establishes the true-#1 baseline whenever the group or ranking perspective
  // changes, so the very first live update afterwards has something correct to compare against
  // instead of possibly celebrating (or failing to celebrate) based on a stale/absent baseline.
  useEffect(() => {
    if (!groupId) return;
    fetchTrueTopFullyRated()
      .then((top) => {
        trueTopIdRef.current = top?.tmdbId ?? null;
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, rankingMemberId]);

  // Celebrates the moment `tmdbId` becomes the group's true #1 (fully rated, highest-ranked
  // overall) as a *result* of the update that just happened - i.e. it wasn't already the true #1
  // beforehand. Always re-derives "true #1" from a dedicated, filter-independent request rather
  // than the (possibly filtered/searched) locally-loaded list, so an active filter can't produce
  // a false celebration for an item that only looks like #1 within a narrowed-down view. Returns
  // whether it celebrated, so callers can fall back to a plain toast when it didn't.
  const checkCelebration = async (tmdbId: number): Promise<boolean> => {
    if (!groupId) return false;
    const prevTopId = trueTopIdRef.current;
    let top: GroupMedia | null = null;
    try {
      top = await fetchTrueTopFullyRated();
    } catch (err) {
      console.error("Top-rank check failed", err);
      return false;
    }
    trueTopIdRef.current = top?.tmdbId ?? null;
    if (top && top.tmdbId === tmdbId && prevTopId !== tmdbId) {
      fireConfetti();
      setSuccessToast(`🎉 "${top.title}" is now #1!`);
      return true;
    }
    return false;
  };

  // Re-fetches the *entire currently-loaded window* (same skip=0, same count as what's already
  // loaded, same filters) fresh from the server and replaces `media` with it wholesale, instead
  // of trying to re-sort or splice a single patched item into the existing local list.
  //
  // Why: the server is the only place that knows the true rank of an item relative to the *whole*
  // group's media, not just whatever subset happens to be loaded locally. A rating change can move
  // an item across a page boundary in either direction (e.g. a low rating should sink it past the
  // end of what's loaded, or a high rating should pull an off-page item onto the visible page) -
  // no amount of client-side re-sorting of a partial list can get that right, since the items it'd
  // need to compare against aren't loaded yet. This is what caused the earlier bug where a newly
  // 0.5-rated item briefly sat at the wrong local position until a scroll-triggered fetch corrected
  // it. Resyncing the whole window from the server after every rating/watch/duration change is the
  // only way to guarantee the visible order is always exactly correct, at the cost of one extra
  // request per change (fine at this app's scale).
  //
  // `mediaWindowSeqRef` guards against this resync's response arriving after a newer page-1
  // load/resync already replaced `media` with something else - stale responses are discarded.
  const resyncMediaWindow = (options?: { tmdbId?: number; fallbackToast?: string }) => {
    if (!groupId) return Promise.resolve();
    const take = Math.max(mediaRef.current.length, MEDIA_PAGE_SIZE);
    const seq = ++mediaWindowSeqRef.current;
    return api
      .get<PagedGroupMedia>(`/api/groups/${groupId}/media?${buildMediaQuery(0, take)}`)
      .then(async (res) => {
        if (seq !== mediaWindowSeqRef.current) return;
        setMedia(res.items);
        setMediaTotalCount(res.totalCount);
        setMediaHasMore(res.hasMore);
        setAvailableGenres(res.availableGenres);
        setTotalMediaInGroup(res.totalMediaInGroup);
        const celebrated = options?.tmdbId !== undefined ? await checkCelebration(options.tmdbId) : false;
        if (!celebrated && options?.fallbackToast) setSuccessToast(options.fallbackToast);
      })
      .catch(() => {});
  };

  // The actual reordering for watcher/rating/voting-duration changes is handled by
  // resyncMediaWindow above. If the item was removed by someone else at the same instant, the
  // resynced window simply won't contain it anymore - no separate handling needed.
  const patchMediaItem = (tmdbId: number) => {
    if (!groupId) return;
    resyncMediaWindow({ tmdbId });
  };

  // Drops one item from the local list without a network round-trip (used for removals, which
  // don't need any fresh data - the item is just gone).
  const removeMediaItemLocally = (tmdbId: number) => {
    setMedia((cur) => cur.filter((m) => m.tmdbId !== tmdbId));
    setMediaTotalCount((c) => Math.max(0, c - 1));
    setTotalMediaInGroup((c) => Math.max(0, c - 1));
  };

  // Keep a ref mirror of `media` up to date for async callbacks (SSE handlers, post-save
  // resyncs) that need the *current* list/length without capturing a stale render's closure.
  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    loadGroupAndStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Re-fetch page 1 whenever the group or any media filter/search/ranking-member changes
  // (covers the very first fetch on mount too, since groupId goes from undefined to set).
  useEffect(() => {
    if (!groupId) return;
    loadMedia(0, MEDIA_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, votingFilter, selectedGenres, ratingFilter, pendingVotesOnly, rankingMemberId, mediaSearch]);

  // Any group/media/voting/rating mutation from anyone (including this same user in
  // another tab) keeps this group's data live. Additions and membership/import-driven
  // changes still do a full resync (new sort position / filter membership isn't safely
  // computable client-side); removals and per-item updates patch the local list in place
  // so the rest of the loaded pages and scroll position aren't disturbed.
  useServerEvent<{ groupId?: number; tmdbId?: number }>("group-updated", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("media-added", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("media-removed", (payload) => {
    if (String(payload?.groupId) === String(groupId) && payload?.tmdbId !== undefined) {
      removeMediaItemLocally(payload.tmdbId);
      loadGroupAndStats();
    }
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("watcher-changed", (payload) => {
    if (String(payload?.groupId) === String(groupId) && payload?.tmdbId !== undefined) {
      patchMediaItem(payload.tmdbId);
      loadGroupAndStats();
    }
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("rating-changed", (payload) => {
    if (String(payload?.groupId) === String(groupId) && payload?.tmdbId !== undefined) {
      patchMediaItem(payload.tmdbId);
      loadGroupAndStats();
    }
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("voting-duration-changed", (payload) => {
    if (String(payload?.groupId) === String(groupId) && payload?.tmdbId !== undefined) patchMediaItem(payload.tmdbId);
  });

  useEffect(() => {
    api.get<UserDirectoryItem[]>("/api/users/directory").then(setAllUsers).catch(() => {});
  }, []);

  // Pick up a toast handed to us via navigation state (e.g. re-navigated here after a
  // background group-deletion failed), then clear it so it doesn't reappear on refresh/back.
  useEffect(() => {
    const toast = (location.state as { toast?: { variant: "success" | "error"; title: string } } | null)?.toast;
    if (!toast) return;
    if (toast.variant === "error") setError(toast.title);
    else setSuccessToast(toast.title);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 500);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Plain scroll-position check instead of an IntersectionObserver sentinel: the observer
  // only fires on isIntersecting *transitions*, and the browser's sampling is coarse enough
  // that a fast scroll/fling can carry the trigger zone through in a single frame, skipping
  // the transition entirely and silently never firing next-page. Checking actual scroll
  // metrics on every real scroll event can't miss like that. Re-subscribes whenever the
  // media list, its filters, or hasMore change, so the closure never reads stale values.
  // Deliberately does NOT check on mount/re-subscribe (only on an actual "scroll" event) -
  // doing so previously caused it to auto-fetch every time the effect re-ran, with no
  // scrolling at all, whenever the page happened to already be within the margin.
  useEffect(() => {
    if (!mediaHasMore) return;
    let loadingMore = false;
    const checkForLoadMore = () => {
      if (loadingMore) return;
      const distanceToBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      if (distanceToBottom > 600) return;
      loadingMore = true;
      loadMedia(media.length, MEDIA_PAGE_SIZE).finally(() => {
        loadingMore = false;
      });
    };
    window.addEventListener("scroll", checkForLoadMore, { passive: true });
    return () => window.removeEventListener("scroll", checkForLoadMore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaHasMore, media.length, groupId, votingFilter, selectedGenres, ratingFilter, pendingVotesOnly, rankingMemberId, mediaSearch]);

  useEffect(() => {
    const t = setTimeout(() => setMediaSearch(mediaSearchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [mediaSearchInput]);

  const memberStatsByUserId = useMemo(() => {
    const map = new Map<number, GroupStats["members"][number]>();
    groupStats?.members.forEach((m) => map.set(m.userId, m));
    return map;
  }, [groupStats]);

  const pendingStatsByDiscordId = useMemo(() => {
    const map = new Map<string, GroupStats["pendingMembers"][number]>();
    groupStats?.pendingMembers.forEach((m) => map.set(m.discordId, m));
    return map;
  }, [groupStats]);

  type SidebarMember =
    | { kind: "real"; key: string; userId: number; displayName: string; avatarUrl: string | null; discordId: string | null; isOwner: boolean; averageRatingGiven: number | null; watchedCount: number }
    | { kind: "pending"; key: string; discordId: string; displayName: string | null; averageRatingGiven: number | null; watchedCount: number };

  const sortedMembers = useMemo((): SidebarMember[] => {
    if (!group) return [];
    const real: SidebarMember[] = group.members.map((m) => {
      const stats = memberStatsByUserId.get(m.userId);
      return {
        kind: "real",
        key: `u${m.userId}`,
        userId: m.userId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        discordId: m.discordId,
        isOwner: m.isOwner,
        averageRatingGiven: stats?.averageRatingGiven ?? null,
        watchedCount: (stats?.moviesWatched ?? 0) + (stats?.tvWatched ?? 0),
      };
    });
    const pending: SidebarMember[] = group.pendingMembers.map((m) => {
      const stats = pendingStatsByDiscordId.get(m.discordId);
      return {
        kind: "pending",
        key: `p${m.discordId}`,
        discordId: m.discordId,
        displayName: m.displayName,
        averageRatingGiven: stats?.averageRatingGiven ?? null,
        watchedCount: (stats?.moviesWatched ?? 0) + (stats?.tvWatched ?? 0),
      };
    });
    const list = [...real, ...pending];
    const nameOf = (m: SidebarMember) => (m.displayName || (m.kind === "pending" ? m.discordId : "")).toLowerCase();
    if (memberSortMode === "watched") {
      return list.sort((a, b) => b.watchedCount - a.watchedCount);
    }
    if (memberSortMode === "rating") {
      return list.sort((a, b) => {
        const aAvg = a.averageRatingGiven;
        const bAvg = b.averageRatingGiven;
        if (aAvg === null && bAvg === null) return 0;
        if (aAvg === null) return 1;
        if (bAvg === null) return -1;
        return bAvg - aAvg;
      });
    }
    return list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [group, memberSortMode, memberStatsByUserId, pendingStatsByDiscordId]);

  const mediaFilterSignature = `${votingFilter}|${mediaSearch}|${rankingMemberId}|${selectedGenres.join(",")}|${ratingFilter}|${pendingVotesOnly}`;

  // Purely decorative now - the actual next-page trigger is the scroll-position check effect
  // above, not this element entering the viewport.
  const mediaSentinelRef = useRef<HTMLDivElement>(null);

  const {
    visibleItems: visibleMembers,
    sentinelRef: membersSentinelRef,
    hasMore: hasMoreMembers,
  } = useInfiniteList(sortedMembers, memberSortMode, 40);

  const computeAverage = (ratings: number[]): number | null =>
    ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const setWatched = async (tmdbId: number, userId: number, watched: boolean) => {
    const prevMedia = media;
    // Optimistic update only touches this item's own fields, not its list position - the
    // authoritative position (which can move across page boundaries) comes from
    // resyncMediaWindow once the save succeeds; see its comment for why.
    setMedia((cur) =>
      cur.map((m) => {
        if (m.tmdbId !== tmdbId) return m;
        // Un-marking as watched also clears any rating server-side, so mirror that here too.
        const watchers = m.watchers.map((w) =>
          w.userId === userId ? { ...w, hasWatched: watched, ...(watched ? {} : { rating: null, comment: null }) } : w
        );
        const ratings = watchers.map((w) => w.rating).filter((r): r is number => r !== null);
        return { ...m, watchers, averageRating: computeAverage(ratings) };
      })
    );
    try {
      await api.post(`/api/groups/${groupId}/media/${tmdbId}/watch/${userId}?watched=${watched}`);
      resyncMediaWindow({ tmdbId, fallbackToast: watched ? "Marked as watched" : "Removed watched status" });
      loadGroupAndStats();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to update watch status");
    }
  };

  const setWatchedPending = async (tmdbId: number, discordId: string, watched: boolean) => {
    const prevMedia = media;
    setMedia((cur) =>
      cur.map((m) => {
        if (m.tmdbId !== tmdbId) return m;
        const watchers = m.watchers.map((w) =>
          w.discordId === discordId ? { ...w, hasWatched: watched, ...(watched ? {} : { rating: null, comment: null }) } : w
        );
        const ratings = watchers.map((w) => w.rating).filter((r): r is number => r !== null);
        return { ...m, watchers, averageRating: computeAverage(ratings) };
      })
    );
    try {
      await api.post(`/api/groups/${groupId}/media/${tmdbId}/watch-pending/${discordId}?watched=${watched}`);
      resyncMediaWindow({ tmdbId, fallbackToast: watched ? "Marked as watched" : "Removed watched status" });
      loadGroupAndStats();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to update watch status");
    }
  };

  const submitRating = async (tmdbId: number, rating: number, comment?: string) => {
    const prevMedia = media;
    const myId = user?.id;
    // Optimistic update only touches this item's own fields, not its list position - see
    // resyncMediaWindow's comment for why the actual position can only come from the server.
    setMedia((cur) =>
      cur.map((m) => {
        if (m.tmdbId !== tmdbId) return m;
        const watchers = m.watchers.map((w) =>
          w.userId === myId ? { ...w, rating, comment: comment ?? null, hasWatched: true } : w
        );
        const ratings = watchers.map((w) => w.rating).filter((r): r is number => r !== null);
        return { ...m, watchers, averageRating: computeAverage(ratings) };
      })
    );
    try {
      await api.post(`/api/groups/${groupId}/media/${tmdbId}/reviews`, {
        rating,
        comment: comment || undefined,
      });
      resyncMediaWindow({ tmdbId, fallbackToast: "Rating saved" });
      loadGroupAndStats();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to submit rating");
    }
  };

  const removeReview = async (tmdbId: number, userId: number) => {
    const prevMedia = media;
    setMedia((cur) =>
      cur.map((m) => {
        if (m.tmdbId !== tmdbId) return m;
        const watchers = m.watchers.map((w) => (w.userId === userId ? { ...w, rating: null, comment: null } : w));
        const ratings = watchers.map((w) => w.rating).filter((r): r is number => r !== null);
        return { ...m, watchers, averageRating: computeAverage(ratings) };
      })
    );
    try {
      await api.delete(`/api/groups/${groupId}/media/${tmdbId}/reviews/${userId}`);
      resyncMediaWindow({ fallbackToast: "Rating removed" });
      loadGroupAndStats();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to remove review");
    }
  };

  const addMember = async (userId: number) => {
    if (!group) return;
    const prevGroup = group;
    const userInfo = allUsers.find((u) => u.id === userId);
    if (userInfo) {
      setGroup({
        ...group,
        members: [
          ...group.members,
          { userId, displayName: userInfo.displayName, avatarUrl: userInfo.avatarUrl, discordId: null, isOwner: false },
        ],
      });
    }
    try {
      await api.post(`/api/groups/${groupId}/members`, { userId });
      setSuccessToast("Member added");
      load();
    } catch (e) {
      setGroup(prevGroup);
      setError(e instanceof Error ? e.message : "Failed to add member");
    }
  };

  const removeMember = async (userId: number) => {
    if (!group) return;
    const prevGroup = group;
    setGroup({ ...group, members: group.members.filter((m) => m.userId !== userId) });
    try {
      await api.delete(`/api/groups/${groupId}/members/${userId}`);
      setSuccessToast("Member removed");
      load();
    } catch (e) {
      setGroup(prevGroup);
      setError(e instanceof Error ? e.message : "Failed to remove member");
    }
  };

  const toggleOwnership = async (userId: number, makeOwner: boolean) => {
    if (!group) return;
    const prevGroup = group;
    setGroup({
      ...group,
      members: group.members.map((m) => (m.userId === userId ? { ...m, isOwner: makeOwner } : m)),
    });
    try {
      await api.patch(`/api/groups/${groupId}/members/${userId}/ownership`, { isOwner: makeOwner });
      setSuccessToast(makeOwner ? "Ownership granted" : "Ownership removed");
      setMemberModal(null);
      load();
    } catch (e) {
      setGroup(prevGroup);
      setError(e instanceof Error ? e.message : "Failed to update ownership");
    }
  };

  const removePendingMember = async (discordId: string) => {
    if (!group) return;
    const prevGroup = group;
    setGroup({ ...group, pendingMembers: group.pendingMembers.filter((p) => p.discordId !== discordId) });
    try {
      await api.delete(`/api/groups/${groupId}/pending-members/${discordId}`);
      setSuccessToast("Pending member removed");
      load();
    } catch (e) {
      setGroup(prevGroup);
      setError(e instanceof Error ? e.message : "Failed to remove pending member");
    }
  };

  const addMedia = async () => {
    if (!newMedia.tmdbId || !newMedia.title || !group) return;
    const prevMedia = media;
    const tmdbId = Number(newMedia.tmdbId);
    const hours = newMedia.votingDurationHours ? Number(newMedia.votingDurationHours) : 24;
    const now = new Date();
    const votingClosesAt = new Date(now.getTime() + hours * 3_600_000);
    const watchedByUserIds = newMedia.watchedByUserIds.filter((id): id is number => typeof id === "number");
    const watchedByDiscordIds = newMedia.watchedByUserIds.filter((id): id is string => typeof id === "string");
    const optimisticMedia: GroupMedia = {
      tmdbId,
      title: newMedia.title,
      type: newMedia.type,
      posterUrl: newMedia.posterUrl,
      addedAt: now.toISOString(),
      votingDurationHours: hours,
      votingClosesAt: votingClosesAt.toISOString(),
      votingOpen: true,
      averageRating: null,
      watchers: [
        ...group.members.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
          hasWatched: watchedByUserIds.includes(m.userId),
          rating: null,
          comment: null,
          isPending: false,
          discordId: m.discordId,
        })),
        ...group.pendingMembers.map((p) => ({
          userId: null,
          displayName: p.displayName || p.discordId,
          avatarUrl: null,
          hasWatched: watchedByDiscordIds.includes(p.discordId),
          rating: null,
          comment: null,
          isPending: true,
          discordId: p.discordId,
        })),
      ],
    };
    setMedia((cur) => [...cur, optimisticMedia]);
    setNewMedia({ tmdbId: "", title: "", type: "movie", posterUrl: null, votingDurationHours: "", watchedByUserIds: [] });
    try {
      await api.post(`/api/groups/${groupId}/media`, {
        tmdbId,
        title: optimisticMedia.title,
        type: optimisticMedia.type,
        posterUrl: optimisticMedia.posterUrl,
        votingDurationHours: newMedia.votingDurationHours ? hours : null,
        watchedByUserIds,
        watchedByDiscordIds,
      });
      setSuccessToast("Media added");
      load();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to add media");
    }
  };

  const handleMediaSelected = (result: MediaSearchResult) => {
    setNewMedia((prev) => ({
      ...prev,
      tmdbId: String(result.tmdbId),
      title: result.title,
      type: result.type,
      posterUrl: result.posterUrl,
    }));
  };

  const updateVotingDuration = async (tmdbId: number, hours: number) => {
    const prevMedia = media;
    setMedia((cur) =>
      cur.map((m) => {
        if (m.tmdbId !== tmdbId) return m;
        const votingClosesAt = new Date(new Date(m.addedAt).getTime() + hours * 3_600_000);
        return {
          ...m,
          votingDurationHours: hours,
          votingClosesAt: votingClosesAt.toISOString(),
          votingOpen: votingClosesAt > new Date(),
        };
      })
    );
    try {
      await api.patch(`/api/groups/${groupId}/media/${tmdbId}/voting-duration`, { votingDurationHours: hours });
      setSuccessToast("Voting duration updated");
      loadGroupAndStats();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to update voting duration");
    }
  };

  const removeMedia = async (tmdbId: number) => {
    const prevMedia = media;
    const prevTotalCount = mediaTotalCount;
    const prevTotalInGroup = totalMediaInGroup;
    setMedia((cur) => cur.filter((m) => m.tmdbId !== tmdbId));
    setMediaTotalCount((c) => Math.max(0, c - 1));
    setTotalMediaInGroup((c) => Math.max(0, c - 1));
    setSelectedTmdbId(null);
    try {
      await api.delete(`/api/groups/${groupId}/media/${tmdbId}`);
      setSuccessToast("Media removed");
      loadGroupAndStats();
    } catch (e) {
      setMedia(prevMedia);
      setMediaTotalCount(prevTotalCount);
      setTotalMediaInGroup(prevTotalInGroup);
      setError(e instanceof Error ? e.message : "Failed to remove media");
    }
  };

  const exportExcel = async () => {
    try {
      const blob = await api.get<Blob>(`/api/groups/${groupId}/excel/export`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rankflix-group-${groupId}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setSuccessToast("Export ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const deleteGroup = () => {
    const name = group?.name;
    // Optimistic: leave the page right away; if the delete turns out to have failed,
    // navigate back here with an error toast instead of leaving the user stranded.
    setShowDeleteGroup(false);
    navigate("/", { state: { toast: { variant: "success", title: name ? `"${name}" deleted` : "Group deleted" } } });
    api.delete(`/api/groups/${groupId}`).catch((e) => {
      navigate(`/groups/${groupId}`, {
        replace: true,
        state: { toast: { variant: "error", title: e instanceof Error ? e.message : "Failed to delete group" } },
      });
    });
  };

  const importExcel = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const result = await api.postForm<ExcelImportResult>(`/api/groups/${groupId}/excel/import`, form);
      setImportToast(result);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  const confirmImport = () => {
    if (!pendingImportFile) return;
    const file = pendingImportFile;
    // Non-blocking: close the confirmation modal right away and let the import run in the
    // background - the exact counts/unmatched-ids can only be known once the server replies,
    // so we surface those via the existing importToast once it resolves.
    setPendingImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    importExcel(file);
  };

  const cancelImport = () => {
    setPendingImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const nonMemberUsers = allUsers.filter((u) => !group?.members.some((m) => m.userId === u.id));
  const selectedMedia = media.find((m) => m.tmdbId === selectedTmdbId) ?? null;
  const isGroupOwner = isAdmin || group?.members.some((m) => m.userId === user?.id && m.isOwner) === true;

  if (!group) return <Spinner full />;

  const votingStatusFilterAny = votingFilter !== "all";
  const anyMediaFilterActive =
    votingStatusFilterAny || selectedGenres.length > 0 || ratingFilter !== null || pendingVotesOnly;

  // Removable chips summarising every active filter/search (search included, since it also
  // narrows the list even though it has its own visible input) - gives a clear, glanceable
  // "something is hiding items right now" signal instead of relying on small active-state
  // styling on individual toggle buttons that's easy to miss, especially on mobile where most
  // filters live behind the "⚙" popover.
  const activeFilterChips: { key: string; label: string; onClear: () => void }[] = [];
  if (mediaSearch) activeFilterChips.push({ key: "search", label: `"${mediaSearch}"`, onClear: () => setMediaSearchInput("") });
  if (votingStatusFilterAny)
    activeFilterChips.push({
      key: "voting",
      label: votingFilter === "open" ? "Voting open" : "Voting closed",
      onClear: () => setVotingFilter("all"),
    });
  selectedGenres.forEach((g) =>
    activeFilterChips.push({ key: `genre-${g}`, label: g, onClear: () => setSelectedGenres((cur) => cur.filter((x) => x !== g)) })
  );
  if (ratingFilter !== null)
    activeFilterChips.push({
      key: "rating",
      label: ratingFilter === "unrated" ? "Unrated only" : `${ratingFilter}+ rating`,
      onClear: () => setRatingFilter(null),
    });
  if (pendingVotesOnly) activeFilterChips.push({ key: "pending", label: "Pending votes", onClear: () => setPendingVotesOnly(false) });

  const clearAllFilters = () => {
    setMediaSearchInput("");
    setVotingFilter("all");
    setSelectedGenres([]);
    setRatingFilter(null);
    setPendingVotesOnly(false);
  };

  // Shared between the always-visible desktop filter row and the single consolidated
  // "Filters" popover shown on mobile, so the two layouts never drift apart.
  const renderVotingStatusToggle = (close?: () => void) => (
    <div className="voting-filter-toggle" role="tablist" aria-label="Filter by voting status">
      <button
        type="button"
        className={votingFilter === "all" ? "active" : ""}
        onClick={() => {
          setVotingFilter("all");
          close?.();
        }}
      >
        All
      </button>
      <button
        type="button"
        className={votingFilter === "open" ? "active" : ""}
        onClick={() => {
          setVotingFilter("open");
          close?.();
        }}
      >
        Open
      </button>
      <button
        type="button"
        className={votingFilter === "closed" ? "active" : ""}
        onClick={() => {
          setVotingFilter("closed");
          close?.();
        }}
      >
        Closed
      </button>
    </div>
  );

  const renderGenreChecklist = () => (
    <div className="filter-popover-checklist">
      {availableGenres.map((g) => (
        <label key={g} className="filter-popover-checkbox-row">
          <input
            type="checkbox"
            checked={selectedGenres.includes(g)}
            onChange={() => setSelectedGenres((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))}
          />
          {g}
        </label>
      ))}
      {selectedGenres.length > 0 && (
        <button type="button" className="filter-popover-clear-btn" onClick={() => setSelectedGenres([])}>
          Clear
        </button>
      )}
    </div>
  );

  const ratingOptions: { value: number | "unrated" | null; label: string }[] = [
    { value: null, label: "Any rating" },
    { value: 9, label: "9+" },
    { value: 8, label: "8+" },
    { value: 7, label: "7+" },
    { value: 6, label: "6+" },
    { value: 5, label: "5+" },
    { value: "unrated", label: "Unrated only" },
  ];

  const renderRatingList = (close: () => void) => (
    <div className="filter-popover-list">
      {ratingOptions.map((opt) => (
        <button
          type="button"
          key={String(opt.value)}
          className={ratingFilter === opt.value ? "active" : ""}
          onClick={() => {
            setRatingFilter(opt.value);
            close();
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const statsSummary =
    groupStats && (groupStats.totalWatchTimeMinutes > 0 || groupStats.totalRatingsCount > 0) ? (
      <>
        {groupStats.totalWatchTimeMinutes > 0 && (
          <p className="muted">⏱ {formatWatchTime(groupStats.totalWatchTimeMinutes)}</p>
        )}
        {groupStats.totalRatingsCount > 0 && (
          <p className="muted">
            ★ {groupStats.overallAverageRating?.toFixed(1)} · {groupStats.totalRatingsCount}
          </p>
        )}
      </>
    ) : null;

  const renderPendingVotesToggle = (close?: () => void) => (
    <button
      type="button"
      className={`filter-toggle-pill${pendingVotesOnly ? " active" : ""}`}
      title="Only show media where someone who watched hasn't voted yet"
      onClick={() => {
        setPendingVotesOnly((v) => !v);
        close?.();
      }}
    >
      Pending votes
    </button>
  );

  return (
    <div>
      <NavBar />
      <main className="page page-wide">
        <div className="page-header-row">
          <div className="group-header-title">
            {group.imageUrl ? (
              <img className="group-header-poster" src={group.imageUrl} alt={group.name} />
            ) : (
              <div className="group-header-poster group-poster-fallback">
                <img src="/favicon.svg" alt="" />
              </div>
            )}
            <h1>{group.name}</h1>
            {isGroupOwner && (
              <button type="button" className="group-edit-btn group-header-edit-btn" title="Edit group" onClick={() => setShowEditGroup(true)}>
                ✎
              </button>
            )}
          </div>
          {statsSummary && <div className="group-stats-summary group-stats-summary-mobile">{statsSummary}</div>}
          <div className="row">
            <button className="excel-btn" onClick={exportExcel}>Export .xlsx</button>
            {isGroupOwner && (
              <label className="file-input-label excel-btn">
                Import .xlsx
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => e.target.files?.[0] && setPendingImportFile(e.target.files[0])}
                />
              </label>
            )}
          </div>
        </div>

        {statsSummary && <div className="group-stats-summary group-stats-summary-desktop">{statsSummary}</div>}

        {isGroupOwner && showEditGroup && (
          <Modal modalClassName="media-modal group-edit-modal" onClose={() => setShowEditGroup(false)}>
            {(requestClose) => (
              <>
                <button className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  ×
                </button>
                <GroupEditForm
                  group={group}
                  onSaved={(patch) => {
                    setGroup((g) => (g ? { ...g, ...patch } : g));
                    setShowEditGroup(false);
                  }}
                  onError={(message) => {
                    setError(message);
                    load();
                  }}
                  onCancel={requestClose}
                  onDeleteRequested={() => { setShowEditGroup(false); setShowDeleteGroup(true); }}
                />
              </>
            )}
          </Modal>
        )}

        {isGroupOwner && showDeleteGroup && (
          <Modal
            overlayClassName="comment-modal-overlay"
            modalClassName="comment-modal confirm-modal"
            onClose={() => setShowDeleteGroup(false)}
          >
            {(requestClose) => (
              <>
                <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                  ×
                </button>
                <p className="confirm-modal-message">
                  Delete <strong>{group.name}</strong>? This can't be undone.
                </p>
                <div className="media-modal-confirm-delete confirm-modal-actions">
                  <button className="danger" onClick={deleteGroup}>
                    Yes, delete
                  </button>
                  <button className="secondary" onClick={requestClose}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </Modal>
        )}

        {isGroupOwner && showAddMedia && (
          <Modal
            modalClassName="media-modal add-media-modal"
            onClose={() => {
              setNewMedia({ tmdbId: "", title: "", type: "movie", posterUrl: null, votingDurationHours: "", watchedByUserIds: [] });
              setShowAddMedia(false);
            }}
          >
            {(requestClose) => (
              <>
                <button className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  ×
                </button>
                <h2>Add media</h2>
                <div className="add-media-form">
                  <div className="add-media-search-row">
                    <MediaAutocomplete onSelect={handleMediaSelected} />
                  </div>
                  {(group.members.length > 0 || group.pendingMembers.length > 0) && (
                    <div className="add-media-watched">
                      <span className="muted add-media-watched-label">Already watched by:</span>
                      <div className="add-media-watched-chips">
                        {group.members.map((m) => {
                          const checked = newMedia.watchedByUserIds.includes(m.userId);
                          return (
                            <button
                              type="button"
                              key={m.userId}
                              className={`add-media-watched-chip${checked ? " active" : ""}`}
                              onClick={() =>
                                setNewMedia((prev) => ({
                                  ...prev,
                                  watchedByUserIds: checked
                                    ? prev.watchedByUserIds.filter((id) => id !== m.userId)
                                    : [...prev.watchedByUserIds, m.userId],
                                }))
                              }
                            >
                              {checked && "✓ "}
                              {m.displayName}
                            </button>
                          );
                        })}
                        {group.pendingMembers.map((p) => {
                          const checked = newMedia.watchedByUserIds.includes(p.discordId);
                          return (
                            <button
                              type="button"
                              key={p.discordId}
                              className={`add-media-watched-chip${checked ? " active" : ""}`}
                              onClick={() =>
                                setNewMedia((prev) => ({
                                  ...prev,
                                  watchedByUserIds: checked
                                    ? prev.watchedByUserIds.filter((id) => id !== p.discordId)
                                    : [...prev.watchedByUserIds, p.discordId],
                                }))
                              }
                            >
                              {checked && "✓ "}
                              {p.displayName || p.discordId}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="row add-media-hours-row">
                    <span className="muted">Voting hours</span>
                    <div className="voting-hours-stepper">
                      <button
                        type="button"
                        aria-label="Decrease voting hours"
                        onClick={() =>
                          setNewMedia((prev) => ({
                            ...prev,
                            votingDurationHours: String(Math.max(1, Number(prev.votingDurationHours || 24) - 1)),
                          }))
                        }
                      >
                        −
                      </button>
                      <span className="voting-hours-value">{newMedia.votingDurationHours || 24}</span>
                      <button
                        type="button"
                        aria-label="Increase voting hours"
                        onClick={() =>
                          setNewMedia((prev) => ({
                            ...prev,
                            votingDurationHours: String(Number(prev.votingDurationHours || 24) + 1),
                          }))
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <button
                      onClick={async () => {
                        await addMedia();
                        requestClose();
                      }}
                      disabled={!newMedia.tmdbId || !newMedia.title}
                    >
                      Add media
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

        <div className="group-layout">
          <div className="media-panel">
            <div className="media-toolbar">
              <div className="media-toolbar-left">
                <div className="view-toggle" role="tablist" aria-label="Media view">
                  <RankingMemberSelect
                    members={group.members}
                    pendingMembers={group.pendingMembers}
                    value={rankingMemberId}
                    onChange={setRankingMemberId}
                  />
                </div>

                <div className="media-search-wrap">
                  <input
                    type="text"
                    className="media-search-input"
                    placeholder="Search media…"
                    value={mediaSearchInput}
                    onChange={(e) => setMediaSearchInput(e.target.value)}
                  />
                  {mediaSearchInput && (
                    <button
                      type="button"
                      className="media-search-clear"
                      onClick={() => setMediaSearchInput("")}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Desktop: each filter shown inline. Hidden on mobile in favour of the
                    single consolidated "Filters" popover below, so mobile doesn't get a
                    tall stack of wrapped rows before the media list even starts. */}
                <div className="media-filters-inline">
                  {renderVotingStatusToggle()}
                  {availableGenres.length > 0 && (
                    <FilterPopover
                      label={selectedGenres.length > 0 ? `Genre (${selectedGenres.length})` : "Genre"}
                      active={selectedGenres.length > 0}
                    >
                      {() => renderGenreChecklist()}
                    </FilterPopover>
                  )}
                  <FilterPopover
                    label={ratingFilter === null ? "Rating" : ratingFilter === "unrated" ? "Unrated" : `${ratingFilter}+`}
                    active={ratingFilter !== null}
                  >
                    {(close) => renderRatingList(close)}
                  </FilterPopover>
                  {renderPendingVotesToggle()}
                </div>

                {/* Mobile: one icon trigger bundling voting status/genre/rating/pending-votes,
                    plus a members-sidebar shortcut - hidden on desktop (see .media-filters-mobile
                    / .media-toolbar-members-btn CSS). */}
                <div className="media-filters-mobile">
                  <FilterPopover label="⚙" active={anyMediaFilterActive} title="Filters">
                    {(close) => (
                      <div className="media-filters-mobile-panel">
                        <div className="filter-popover-mobile-section">
                          <span className="filter-popover-section-label">Voting status</span>
                          {renderVotingStatusToggle(close)}
                        </div>
                        {availableGenres.length > 0 && (
                          <div className="filter-popover-mobile-section">
                            <span className="filter-popover-section-label">Genre</span>
                            {renderGenreChecklist()}
                          </div>
                        )}
                        <div className="filter-popover-mobile-section">
                          <span className="filter-popover-section-label">Rating</span>
                          {renderRatingList(close)}
                        </div>
                        <div className="filter-popover-mobile-section">
                          {renderPendingVotesToggle(close)}
                        </div>
                      </div>
                    )}
                  </FilterPopover>
                  <button
                    type="button"
                    className="media-toolbar-icon-btn media-toolbar-members-btn"
                    title={membersExpanded ? "Hide members" : "Show members"}
                    onClick={() => setMembersExpanded((v) => !v)}
                  >
                    👥
                  </button>
                </div>
              </div>

              {isGroupOwner && !showAddMedia && (
                <button type="button" className="media-toolbar-add-btn" onClick={() => setShowAddMedia(true)}>
                  + Add media
                </button>
              )}
            </div>

            {activeFilterChips.length > 0 && (
              <div className="active-filters-bar" role="status">
                <span className="active-filters-label">Filtered</span>
                {activeFilterChips.map((chip) => (
                  <button type="button" key={chip.key} className="active-filter-chip" onClick={chip.onClear} title="Remove this filter">
                    {chip.label}
                    <span className="active-filter-chip-x" aria-hidden="true">×</span>
                  </button>
                ))}
                <button type="button" className="active-filters-clear-all" onClick={clearAllFilters}>
                  Clear all
                </button>
              </div>
            )}

            {!mediaLoading && totalMediaInGroup > 0 && (
              <p className="muted list-count-text">
                {mediaTotalCount} media {mediaTotalCount === 1 ? "item" : "items"}
              </p>
            )}
            {!mediaLoading && totalMediaInGroup === 0 && (
              <EmptyState
                icon="🍿"
                title="No media in this group"
                subtitle="Add a movie or show above to start ranking and voting."
              />
            )}
            {mediaLoading ? (
              <ol className="media-ranking-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i}>
                    <MediaRowSkeleton />
                  </li>
                ))}
              </ol>
            ) : (
            <ol className="media-ranking-list">
                {totalMediaInGroup > 0 && media.length === 0 && (
                  <p className="muted">
                    {mediaSearch ? `No media matches "${mediaSearchInput}".` : "No media matches the current filters."}
                  </p>
                )}
                {media.map((m, i) => {
                  const watchedList = m.watchers.filter((w) => w.hasWatched);
                  const ratedCount = watchedList.filter((w) => w.rating !== null).length;
                  const displayRating =
                    rankingMemberId === "average"
                      ? m.averageRating
                      : typeof rankingMemberId === "number"
                        ? m.watchers.find((w) => w.userId === rankingMemberId)?.rating ?? null
                        : m.watchers.find((w) => w.discordId === rankingMemberId)?.rating ?? null;
                  const posInPage = i % MEDIA_PAGE_SIZE;
                  return (
                    <li
                      key={`${m.tmdbId}:${mediaFilterSignature}`}
                      className="media-row-enter"
                      style={{ animationDelay: `${Math.min(posInPage, 15) * 25}ms` }}
                    >
                      <button type="button" className="media-ranking-row" onClick={() => setSelectedTmdbId(m.tmdbId)}>
                        <span className="media-ranking-number">#{i + 1}</span>
                        <div className="media-ranking-poster-wrap">
                          {m.posterUrl ? (
                            <img className="media-ranking-poster" src={m.posterUrl} alt={m.title} />
                          ) : (
                            <div className="media-ranking-poster media-poster-fallback">
                              <img src="/favicon.svg" alt="" />
                            </div>
                          )}
                        </div>
                        <div className="media-ranking-info">
                          <span className="media-card-title">
                            {m.title}
                            {m.year ? <span className="media-modal-year"> ({m.year})</span> : null}
                          </span>
                          <span className="media-ranking-meta muted">
                            <span className="media-modal-type-badge">{m.type}</span>
                            {m.runtimeMinutes ? (
                              <span className="media-ranking-meta-item">{formatWatchTime(m.runtimeMinutes)}</span>
                            ) : null}
                          </span>
                          <VotingStatusBadge media={m} />
                        </div>
                        <div className="media-ranking-score-wrap">
                          <span className="media-ranking-score">
                            {displayRating !== null ? `★ ${displayRating.toFixed(1)}` : "—"}
                          </span>
                          <span className="media-ranking-rated-count muted">
                            {ratedCount}/{watchedList.length} rated
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
              {mediaHasMore && <InfiniteScrollLoader sentinelRef={mediaSentinelRef} />}
          </div>

          <aside className={`member-sidebar${membersExpanded ? " expanded" : ""}`}>
            <div className="member-sidebar-header">
              <h2>Members — {group.members.length + group.pendingMembers.length}</h2>
              <div className="member-sidebar-header-actions">
                <button
                  type="button"
                  className="member-sort-toggle"
                  onClick={() =>
                    setMemberSortMode((v) => (v === "az" ? "rating" : v === "rating" ? "watched" : "az"))
                  }
                  title="Cycle member sort: A-Z, average rating given, most watched"
                >
                  {memberSortMode === "rating" ? "★ By rating" : memberSortMode === "watched" ? "👁 Most watched" : "A-Z"}
                </button>
                <button
                  type="button"
                  className="member-sidebar-mobile-toggle"
                  onClick={() => setMembersExpanded((v) => !v)}
                >
                  {membersExpanded ? "Hide ▲" : "Show ▼"}
                </button>
              </div>
            </div>

            <div className={`member-sidebar-body${membersExpanded ? " expanded" : ""}`}>
              {isGroupOwner && (
                <div className="member-sidebar-add">
                  <AddMemberDropdown users={nonMemberUsers} onAdd={addMember} />
                </div>
              )}

              <ul className="member-sidebar-list">
                {visibleMembers.map((m, mi) => {
                  const rowStyle = { animationDelay: `${Math.min(mi, 15) * 25}ms` };
                  if (m.kind === "pending") {
                    const stats = pendingStatsByDiscordId.get(m.discordId);
                    const label = m.displayName || m.discordId;
                    return (
                      <li
                        key={m.key}
                        className="member-sidebar-row member-sidebar-row-pending member-sidebar-row-clickable member-row-enter"
                        style={rowStyle}
                        onClick={() => setMemberModal(m)}
                      >
                        <div className="avatar avatar-pending" style={{ width: 40, height: 40 }} title={`Discord id: ${m.discordId}`}>
                          {label.charAt(0).toUpperCase()}
                        </div>
                        <div className="member-sidebar-info">
                          <span className="member-sidebar-name">
                            {label}
                            <span className="member-pending-badge">Pending</span>
                          </span>
                          {stats && (
                            <span className="member-sidebar-stats muted">
                              {stats.moviesWatched + stats.tvWatched} watched
                              {stats.averageRatingGiven !== null && ` · ★ ${stats.averageRatingGiven.toFixed(1)} avg`}
                            </span>
                          )}
                        </div>
                        {isGroupOwner && (
                          <button
                            className="member-remove"
                            title="Remove pending member"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRemove({ kind: "pending", discordId: m.discordId, label });
                            }}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  }

                  const stats = memberStatsByUserId.get(m.userId);
                  return (
                    <li
                      key={m.key}
                      className="member-sidebar-row member-sidebar-row-clickable member-row-enter"
                      style={rowStyle}
                      onClick={() => setMemberModal(m)}
                    >
                      <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={40} online={isOnline(m.userId)} />
                      <div className="member-sidebar-info">
                        <span className="member-sidebar-name">
                          {m.displayName}
                          {m.isOwner && <span className="member-owner-badge" title="Owner">👑</span>}
                        </span>
                        {stats && (
                          <span className="member-sidebar-stats muted">
                            {stats.moviesWatched + stats.tvWatched} watched
                            {stats.averageRatingGiven !== null && ` · ★ ${stats.averageRatingGiven.toFixed(1)} avg`}
                          </span>
                        )}
                      </div>
                      {isGroupOwner && !m.isOwner && (
                        <button
                          className="member-remove"
                          title="Remove member"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingRemove({ kind: "member", userId: m.userId, label: m.displayName });
                          }}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {hasMoreMembers && <InfiniteScrollLoader sentinelRef={membersSentinelRef} />}
            </div>
          </aside>
        </div>
      </main>

      {selectedMedia && (
        <MediaDetailModal
          media={selectedMedia}
          canManage={isGroupOwner}
          isSiteAdmin={isAdmin}
          currentUserId={user?.id}
          onClose={() => setSelectedTmdbId(null)}
          onSubmitRating={(rating, comment) => submitRating(selectedMedia.tmdbId, rating, comment)}
          onUpdateVotingDuration={(hours) => updateVotingDuration(selectedMedia.tmdbId, hours)}
          onDelete={() => removeMedia(selectedMedia.tmdbId)}
          onRemoveReview={(userId) => removeReview(selectedMedia.tmdbId, userId)}
          onSetWatched={(userId, watched) => setWatched(selectedMedia.tmdbId, userId, watched)}
          onSetWatchedPending={(discordId, watched) => setWatchedPending(selectedMedia.tmdbId, discordId, watched)}
        />
      )}

      {memberModal && (
        <MemberDetailModal
          kind={memberModal.kind}
          name={memberModal.kind === "real" ? memberModal.displayName : memberModal.displayName || memberModal.discordId}
          avatarUrl={memberModal.kind === "real" ? memberModal.avatarUrl : null}
          isOwner={memberModal.kind === "real" ? memberModal.isOwner : false}
          online={memberModal.kind === "real" ? isOnline(memberModal.userId) : undefined}
          discordId={memberModal.kind === "real" ? memberModal.discordId : memberModal.discordId}
          canManage={isGroupOwner}
          userId={memberModal.kind === "real" ? memberModal.userId : undefined}
          isSelf={memberModal.kind === "real" && memberModal.userId === user?.id}
          stats={
            memberModal.kind === "real"
              ? memberStatsByUserId.get(memberModal.userId)
              : pendingStatsByDiscordId.get(memberModal.discordId)
          }
          onClose={() => setMemberModal(null)}
          onToggleOwnership={toggleOwnership}
        />
      )}

      {pendingRemove && (
        <Modal
          overlayClassName="comment-modal-overlay"
          modalClassName="comment-modal confirm-modal"
          onClose={() => setPendingRemove(null)}
        >
          {(requestClose) => (
            <>
              <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                ×
              </button>
              <p className="confirm-modal-message">
                Remove <strong>{pendingRemove.label}</strong> from this group?
              </p>
              <div className="media-modal-confirm-delete confirm-modal-actions">
                <button
                  className="danger"
                  onClick={() => {
                    if (pendingRemove.kind === "member") removeMember(pendingRemove.userId);
                    else removePendingMember(pendingRemove.discordId);
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

      {showScrollTop && (
        <button
          className="scroll-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Scroll to top"
        >
          ↑
        </button>
      )}

      {pendingImportFile && (
        <Modal modalClassName="media-modal confirm-modal" onClose={cancelImport}>
          {(requestClose) => (
            <>
              <h2>Import "{pendingImportFile.name}"?</h2>
              <p className="muted">This overwrites the group's media, reviews, and watch statuses. Can't be undone.</p>
              <div className="row confirm-modal-actions">
                <button onClick={confirmImport}>Yes, import & overwrite</button>
                <button className="secondary" onClick={requestClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {importToast && (
        <Toast
          variant="success"
          title="Import complete"
          details={[
            `${importToast.mediaImported} media, ${importToast.reviewsImported} reviews, ${importToast.watchStatusesImported} watch statuses imported`,
            ...(importToast.mediaRemoved ? [`${importToast.mediaRemoved} media removed (not in file)`] : []),
            ...(importToast.unmatchedDiscordIds.length
              ? [`${importToast.unmatchedDiscordIds.length} discord id(s) saved as pending — link later via account settings`]
              : []),
          ]}
          duration={importToast.unmatchedDiscordIds.length ? 7000 : 4500}
          onClose={() => setImportToast(null)}
        />
      )}
      {error && (
        <Toast
          variant="error"
          title={error}
          duration={7000}
          onClose={() => setError(null)}
          style={importToast ? { top: 110 } : undefined}
        />
      )}
      {successToast && (
        <Toast
          variant="success"
          title={successToast}
          duration={4000}
          onClose={() => setSuccessToast(null)}
          style={{ top: 24 + (importToast ? 86 : 0) + (error ? 86 : 0) }}
        />
      )}
    </div>
  );
}

