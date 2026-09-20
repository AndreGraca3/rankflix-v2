import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import confetti from "canvas-confetti";
import { Pencil, Dices, Check, Users, X, Popcorn, Globe, Eye, Crown, Settings, ArrowUp } from "lucide-react";
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
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
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
  // Maps tmdbId -> its rank (1-based) in the *unfiltered* ranking (same ranking-member
  // perspective, but ignoring search/genre/rating/voting-status/pending-votes filters) - so a
  // filtered/narrowed view can still show "this item is normally #N overall" next to its
  // filtered-list position. Rebuilt whenever the underlying media/ratings change, independent of
  // which display filters are currently active.
  const [originalRanks, setOriginalRanks] = useState<Record<number, number>>({});
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
  const [mediaSortBy, setMediaSortBy] = useState<"rating" | "title" | "added">("rating");
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
    if (mediaSortBy !== "rating") params.set("sortBy", mediaSortBy);
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
    loadOriginalRanks();
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

  // Fetches the canonical group-average / highest-rated-first ranking (no filters, no ranking-
  // member perspective, no custom sort) and turns it into a tmdbId -> 1-based-rank lookup, so the
  // visible (possibly filtered, re-sorted, or viewed-as-a-specific-member's) list can show each
  // item's true overall position for comparison.
  const loadOriginalRanks = async () => {
    if (!groupId) return;
    const params = new URLSearchParams();
    params.set("skip", "0");
    params.set("take", "1000");
    try {
      const res = await api.get<PagedGroupMedia>(`/api/groups/${groupId}/media?${params.toString()}`);
      const map: Record<number, number> = {};
      res.items.forEach((item, idx) => {
        map[item.tmdbId] = idx + 1;
      });
      setOriginalRanks(map);
    } catch {
      // Non-critical - the "original rank" hint just won't show if this fails.
    }
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
    loadOriginalRanks();
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
        loadOriginalRanks();
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
  }, [groupId, votingFilter, selectedGenres, ratingFilter, pendingVotesOnly, rankingMemberId, mediaSearch, mediaSortBy]);
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
  }, [mediaHasMore, media.length, groupId, votingFilter, selectedGenres, ratingFilter, pendingVotesOnly, rankingMemberId, mediaSearch, mediaSortBy]);

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

  const mediaFilterSignature = `${votingFilter}|${mediaSearch}|${rankingMemberId}|${selectedGenres.join(",")}|${ratingFilter}|${pendingVotesOnly}|${mediaSortBy}`;
  // Now that `originalRanks` always holds the canonical group-average ranking (see
  // loadOriginalRanks), any of the narrowing filters, a non-default sort, *or* viewing a specific
  // member's perspective can make the visible order diverge from it - all of them should surface
  // the "original overall rank" hint.
  const mediaFiltersActive =
    votingFilter !== "all" ||
    mediaSearch !== "" ||
    selectedGenres.length > 0 ||
    ratingFilter !== null ||
    pendingVotesOnly ||
    mediaSortBy !== "rating" ||
    rankingMemberId !== "average";

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
    votingStatusFilterAny || selectedGenres.length > 0 || ratingFilter !== null || pendingVotesOnly || mediaSortBy !== "rating";

  const sortByOptions: { value: typeof mediaSortBy; label: string }[] = [
    { value: "rating", label: "Highest rated" },
    { value: "title", label: "Title (A-Z)" },
    { value: "added", label: "Recently added" },
  ];

  // Same "whose ratings" lookup RankingMemberSelect uses internally for its own label, reused
  // here so the active-filters chip bar can show it too.
  const rankingMemberLabel =
    rankingMemberId === "average"
      ? null
      : typeof rankingMemberId === "number"
        ? `${group.members.find((m) => m.userId === rankingMemberId)?.displayName ?? "?"}'s ratings`
        : `${group.pendingMembers.find((p) => p.discordId === rankingMemberId)?.displayName ?? rankingMemberId}'s ratings`;

  // Removable chips summarising every active filter/search/sort/ranking-perspective (search
  // included, since it also narrows the list even though it has its own visible input) - gives a
  // clear, glanceable "something is changing what you see right now" signal instead of relying on
  // small active-state styling on individual toggle buttons that's easy to miss, especially on
  // mobile where most of these live behind the "⚙" popover.
  const activeFilterChips: { key: string; label: string; onClear: () => void }[] = [];
  if (mediaSearch) activeFilterChips.push({ key: "search", label: `"${mediaSearch}"`, onClear: () => setMediaSearchInput("") });
  if (rankingMemberLabel)
    activeFilterChips.push({ key: "ranking-member", label: rankingMemberLabel, onClear: () => setRankingMemberId("average") });
  if (mediaSortBy !== "rating")
    activeFilterChips.push({
      key: "sort",
      label: `Sort: ${sortByOptions.find((o) => o.value === mediaSortBy)?.label ?? mediaSortBy}`,
      onClear: () => setMediaSortBy("rating"),
    });
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
    setRankingMemberId("average");
    setMediaSortBy("rating");
    setVotingFilter("all");
    setSelectedGenres([]);
    setRatingFilter(null);
    setPendingVotesOnly(false);
  };

  // Shared between the always-visible desktop filter row and the single consolidated
  // "Filters" popover shown on mobile, so the two layouts never drift apart.
  const renderVotingStatusToggle = (close?: () => void) => (
    <div
      className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted p-1 max-[680px]:w-full max-[680px]:justify-between"
      role="tablist"
      aria-label="Filter by voting status"
    >
      <button data-slot="button"
        type="button"
        className={
          votingFilter === "all"
            ? "rounded-full bg-primary px-4 py-[7px] text-[13px] font-semibold text-primary-foreground max-[680px]:flex-1 max-[680px]:px-1"
            : "rounded-full px-4 py-[7px] text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground max-[680px]:flex-1 max-[680px]:px-1"
        }
        onClick={() => {
          setVotingFilter("all");
          close?.();
        }}
      >
        All
      </button>
      <button data-slot="button"
        type="button"
        className={
          votingFilter === "open"
            ? "rounded-full bg-primary px-4 py-[7px] text-[13px] font-semibold text-primary-foreground max-[680px]:flex-1 max-[680px]:px-1"
            : "rounded-full px-4 py-[7px] text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground max-[680px]:flex-1 max-[680px]:px-1"
        }
        onClick={() => {
          setVotingFilter("open");
          close?.();
        }}
      >
        Open
      </button>
      <button data-slot="button"
        type="button"
        className={
          votingFilter === "closed"
            ? "rounded-full bg-primary px-4 py-[7px] text-[13px] font-semibold text-primary-foreground max-[680px]:flex-1 max-[680px]:px-1"
            : "rounded-full px-4 py-[7px] text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground max-[680px]:flex-1 max-[680px]:px-1"
        }
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
    <div className="flex flex-col gap-0.5">
      {availableGenres.map((g) => (
        <Label
          key={g}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-normal text-foreground hover:bg-secondary"
        >
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-primary"
            checked={selectedGenres.includes(g)}
            onChange={() => setSelectedGenres((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))}
          />
          {g}
        </Label>
      ))}
      {selectedGenres.length > 0 && (
        <button data-slot="button"
          type="button"
          className="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-left text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
          onClick={() => setSelectedGenres([])}
        >
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
    <div className="flex flex-col gap-0.5">
      {ratingOptions.map((opt) => (
        <button data-slot="button"
          type="button"
          key={String(opt.value)}
          className={
            ratingFilter === opt.value
              ? "rounded-lg bg-primary px-2.5 py-2 text-left text-sm text-primary-foreground"
              : "rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
          }
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

  const renderSortByList = (close: () => void) => (
    <div className="flex flex-col gap-0.5">
      {sortByOptions.map((opt) => (
        <button data-slot="button"
          type="button"
          key={opt.value}
          className={
            mediaSortBy === opt.value
              ? "rounded-lg bg-primary px-2.5 py-2 text-left text-sm text-primary-foreground"
              : "rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
          }
          onClick={() => {
            setMediaSortBy(opt.value);
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
          <p className="m-0 text-[13px] text-muted-foreground">⏱ {formatWatchTime(groupStats.totalWatchTimeMinutes)}</p>
        )}
        {groupStats.totalRatingsCount > 0 && (
          <p className="m-0 text-[13px] text-muted-foreground">
            ★ {groupStats.overallAverageRating?.toFixed(1)} · {groupStats.totalRatingsCount}
          </p>
        )}
      </>
    ) : null;

  const renderPendingVotesToggle = (close?: () => void) => (
    <button data-slot="button"
      type="button"
      className={
        pendingVotesOnly
          ? "rounded-full border border-primary bg-primary px-[14px] py-[7px] text-[13px] font-semibold whitespace-nowrap text-primary-foreground"
          : "rounded-full border border-border bg-secondary px-[14px] py-[7px] text-[13px] font-semibold whitespace-nowrap text-foreground transition-colors hover:border-primary"
      }
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
      <main className="mx-auto max-w-[1200px] px-6 py-8 pb-16 max-[680px]:px-[14px] max-[680px]:py-[18px] max-[680px]:pb-12">
        <div className="mb-7 flex items-center justify-between gap-3 max-[680px]:mb-[18px] max-[680px]:flex-col max-[680px]:items-stretch max-[680px]:gap-3">
          <div className="flex items-center gap-3.5">
            {group.imageUrl ? (
              <img
                className="h-[128px] w-[128px] shrink-0 rounded-lg border border-border object-cover shadow-lg max-[680px]:h-[68px] max-[680px]:w-[68px]"
                src={group.imageUrl}
                alt={group.name}
              />
            ) : (
              <div className="flex h-[128px] w-[128px] shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-lg max-[680px]:h-[68px] max-[680px]:w-[68px]">
                <img src="/favicon.svg" alt="" className="h-1/2 w-1/2 opacity-40" />
              </div>
            )}
            <h1 className="m-0">{group.name}</h1>
            {isGroupOwner && (
              <button data-slot="button"
                type="button"
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-muted p-0 text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                title="Edit group"
                onClick={() => setShowEditGroup(true)}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          {statsSummary && (
            <div className="hidden flex-col gap-0.5 max-[680px]:mt-[-4px] max-[680px]:flex">
              {statsSummary}
            </div>
          )}
          <div className="my-3 flex flex-wrap items-center gap-2 max-[680px]:m-0">
            <Button
              type="button"
              className="transition-transform hover:scale-105 max-[680px]:flex-1 max-[680px]:justify-center max-[680px]:text-center"
              onClick={() => navigate(`/groups/${groupId}/suggestions`)}
            >
              <Dices size={14} className="inline-block align-[-2px] mr-1" /> Suggestions
            </Button>
            <Button
              type="button"
              className="transition-transform hover:scale-105 max-[680px]:flex-1 max-[680px]:justify-center max-[680px]:text-center"
              onClick={exportExcel}
            >
              Export .xlsx
            </Button>
            {isGroupOwner && (
              <label className="relative inline-flex cursor-pointer items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 max-[680px]:flex-1 max-[680px]:justify-center max-[680px]:text-center">
                Import .xlsx
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                  onChange={(e) => e.target.files?.[0] && setPendingImportFile(e.target.files[0])}
                />
              </label>
            )}
          </div>
        </div>

        {statsSummary && <div className="-mt-2 mb-5 flex flex-col gap-0.5 max-[680px]:hidden">{statsSummary}</div>}

        {isGroupOwner && showEditGroup && (
          <Modal modalClassName="media-modal group-edit-modal" onClose={() => setShowEditGroup(false)}>
            {(requestClose) => (
              <>
                <button data-slot="button" className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  <X size={18} />
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
                <button data-slot="button" className="media-modal-close" onClick={requestClose} title="Close" type="button">
                  <X size={18} />
                </button>
                <p className="mt-7 text-[15px] leading-normal">
                  Delete <strong>{group.name}</strong>? This can't be undone.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="destructive" onClick={deleteGroup}>
                    Yes, delete
                  </Button>
                  <Button type="button" variant="outline" onClick={requestClose}>
                    Cancel
                  </Button>
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
                <button data-slot="button" className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  <X size={18} />
                </button>
                <h2 className="mt-0">Add media</h2>
                <div className="flex max-w-[480px] flex-col gap-2.5">
                  <div className="flex items-start gap-2 max-[680px]:flex-col max-[680px]:items-stretch">
                    <MediaAutocomplete onSelect={handleMediaSelected} />
                  </div>
                  {(group.members.length > 0 || group.pendingMembers.length > 0) && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-muted-foreground">Already watched by:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {group.members.map((m) => {
                          const checked = newMedia.watchedByUserIds.includes(m.userId);
                          return (
                            <button data-slot="button"
                              type="button"
                              key={m.userId}
                              className={
                                checked
                                  ? "inline-flex items-center rounded-full border border-primary bg-primary px-3 py-[5px] text-[13px] font-medium text-primary-foreground"
                                  : "inline-flex items-center rounded-full border border-border bg-card px-3 py-[5px] text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                              }
                              onClick={() =>
                                setNewMedia((prev) => ({
                                  ...prev,
                                  watchedByUserIds: checked
                                    ? prev.watchedByUserIds.filter((id) => id !== m.userId)
                                    : [...prev.watchedByUserIds, m.userId],
                                }))
                              }
                            >
                              {checked && <Check size={12} className="inline-block align-[-2px] mr-0.5" />}
                              {m.displayName}
                            </button>
                          );
                        })}
                        {group.pendingMembers.map((p) => {
                          const checked = newMedia.watchedByUserIds.includes(p.discordId);
                          return (
                            <button data-slot="button"
                              type="button"
                              key={p.discordId}
                              className={
                                checked
                                  ? "inline-flex items-center rounded-full border border-primary bg-primary px-3 py-[5px] text-[13px] font-medium text-primary-foreground"
                                  : "inline-flex items-center rounded-full border border-border bg-card px-3 py-[5px] text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                              }
                              onClick={() =>
                                setNewMedia((prev) => ({
                                  ...prev,
                                  watchedByUserIds: checked
                                    ? prev.watchedByUserIds.filter((id) => id !== p.discordId)
                                    : [...prev.watchedByUserIds, p.discordId],
                                }))
                              }
                            >
                              {checked && <Check size={12} className="inline-block align-[-2px] mr-0.5" />}
                              {p.displayName || p.discordId}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="my-3 flex flex-wrap items-center gap-[10px]">
                    <span className="text-[13px] text-muted-foreground">Voting hours</span>
                    <div className="inline-flex items-center overflow-hidden rounded-full border border-border">
                      <button data-slot="button"
                        type="button"
                        className="flex h-7 w-7 items-center justify-center bg-card p-0 text-base font-bold leading-none text-foreground transition-colors hover:bg-secondary"
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
                      <span className="min-w-[34px] text-center text-[13px] font-bold text-foreground">
                        {newMedia.votingDurationHours || 24}
                      </span>
                      <button data-slot="button"
                        type="button"
                        className="flex h-7 w-7 items-center justify-center bg-card p-0 text-base font-bold leading-none text-foreground transition-colors hover:bg-secondary"
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
                  <div className="my-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      onClick={async () => {
                        await addMedia();
                        requestClose();
                      }}
                      disabled={!newMedia.tmdbId || !newMedia.title}
                    >
                      Add media
                    </Button>
                    <Button type="button" variant="outline" onClick={requestClose}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Modal>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-7 max-[860px]:grid-cols-1">
          <div className="min-w-0 max-[680px]:px-1">
            <div className="mb-5 flex items-center justify-between gap-4 max-[680px]:flex-col max-[680px]:items-stretch">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3 max-[680px]:flex-nowrap max-[680px]:gap-2">
                <div className="w-fit shrink-0" role="tablist" aria-label="Media view">
                  <RankingMemberSelect
                    members={group.members}
                    pendingMembers={group.pendingMembers}
                    value={rankingMemberId}
                    onChange={setRankingMemberId}
                  />
                </div>

                {/* Actual sort-order control - distinct from the ranking-perspective (⇅) picker
                    above, which changes *whose* ratings the list is ranked by, not *how* it's
                    ordered. Desktop-only; mirrored inside the mobile Filters popover below. */}
                <div className="flex items-center max-[680px]:hidden">
                  <FilterPopover
                    label={`Sort: ${sortByOptions.find((o) => o.value === mediaSortBy)?.label ?? "Highest rated"}`}
                    active={mediaSortBy !== "rating"}
                  >
                    {(close) => renderSortByList(close)}
                  </FilterPopover>
                </div>

                <div className="relative flex min-w-0 flex-1 items-center max-w-[220px] max-[680px]:max-w-none">
                  <Input
                    type="text"
                    className="h-9 w-[220px] rounded-full bg-muted pr-[30px] pl-[14px] text-sm max-[680px]:w-full"
                    placeholder="Search media…"
                    value={mediaSearchInput}
                    onChange={(e) => setMediaSearchInput(e.target.value)}
                  />
                  {mediaSearchInput && (
                    <button data-slot="button"
                      type="button"
                      className="absolute right-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                      onClick={() => setMediaSearchInput("")}
                      title="Clear search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Desktop: each filter shown inline. Hidden on mobile in favour of the
                    single consolidated "Filters" popover below, so mobile doesn't get a
                    tall stack of wrapped rows before the media list even starts. */}
                <div className="flex items-center flex-wrap gap-x-4 gap-y-3 max-[680px]:hidden">
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
                <div className="hidden items-center gap-2 max-[680px]:flex max-[680px]:shrink-0">
                  <FilterPopover label={<Settings size={16} />} active={anyMediaFilterActive} title="Filters">
                    {(close) => (
                      <div className="flex min-w-[220px] flex-col gap-3.5">
                        <div className="flex flex-col gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-[0.03em] text-muted-foreground">Sort by</span>
                          {renderSortByList(close)}
                        </div>
                        <div className="flex flex-col gap-2 border-t border-border pt-3">
                          <span className="text-[11px] font-bold uppercase tracking-[0.03em] text-muted-foreground">Voting status</span>
                          {renderVotingStatusToggle(close)}
                        </div>
                        {availableGenres.length > 0 && (
                          <div className="flex flex-col gap-2 border-t border-border pt-3">
                            <span className="text-[11px] font-bold uppercase tracking-[0.03em] text-muted-foreground">Genre</span>
                            {renderGenreChecklist()}
                          </div>
                        )}
                        <div className="flex flex-col gap-2 border-t border-border pt-3">
                          <span className="text-[11px] font-bold uppercase tracking-[0.03em] text-muted-foreground">Rating</span>
                          {renderRatingList(close)}
                        </div>
                        <div className="flex flex-col gap-2 border-t border-border pt-3">
                          {renderPendingVotesToggle(close)}
                        </div>
                      </div>
                    )}
                  </FilterPopover>
                  <button data-slot="button"
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary transition-colors hover:border-primary"
                    title={membersExpanded ? "Hide members" : "Show members"}
                    onClick={() => setMembersExpanded((v) => !v)}
                  >
                    <Users size={16} />
                  </button>
                </div>
              </div>

              {isGroupOwner && !showAddMedia && (
                <Button
                  type="button"
                  className="shrink-0 whitespace-nowrap transition-transform hover:scale-[1.06] max-[680px]:w-full"
                  onClick={() => setShowAddMedia(true)}
                >
                  + Add media
                </Button>
              )}
            </div>

            {activeFilterChips.length > 0 && (
              <div
                className="mt-1 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-2.5 py-2 animate-in fade-in slide-in-from-top-1 duration-200"
                role="status"
              >
                <span className="inline-flex items-center gap-1.5 pr-0.5 text-[12px] font-bold uppercase tracking-[0.02em] text-primary before:h-[7px] before:w-[7px] before:rounded-full before:bg-primary before:shadow-[0_0_0_3px_rgba(255,176,32,0.25)] before:content-['']">
                  Filtered
                </span>
                {activeFilterChips.map((chip) => (
                  <button data-slot="button"
                    type="button"
                    key={chip.key}
                    className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 pl-3 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                    onClick={chip.onClear}
                    title="Remove this filter"
                  >
                    {chip.label}
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-xs leading-none" aria-hidden="true">
                      <X size={11} />
                    </span>
                  </button>
                ))}
                <button data-slot="button"
                  type="button"
                  className="ml-auto whitespace-nowrap px-1.5 py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-primary hover:underline"
                  onClick={clearAllFilters}
                >
                  Clear all
                </button>
              </div>
            )}

            {!mediaLoading && totalMediaInGroup > 0 && (
              <p className="my-2 mb-4 text-[13px] text-muted-foreground">
                {mediaTotalCount} media {mediaTotalCount === 1 ? "item" : "items"}
              </p>
            )}
            {!mediaLoading && totalMediaInGroup === 0 && (
              <EmptyState
                icon={<Popcorn size={40} />}
                title="No media in this group"
                subtitle="Add a movie or show above to start ranking and voting."
              />
            )}
            {mediaLoading ? (
              <ol className="mb-6 flex list-none flex-col gap-2.5 p-0">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i}>
                    <MediaRowSkeleton />
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="mb-6 flex list-none flex-col gap-2.5 p-0">
                {totalMediaInGroup > 0 && media.length === 0 && (
                  <p className="text-[13px] text-muted-foreground">
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
                      className="animate-[media-row-slide-in_0.35s_ease_both] motion-reduce:animate-none"
                      style={{ animationDelay: `${Math.min(posInPage, 15) * 25}ms` }}
                    >
                      <button data-slot="button"
                        type="button"
                        className="flex w-full items-center gap-[18px] rounded-lg border border-border bg-muted px-5 py-3.5 text-left transition-transform transition-colors hover:scale-[1.01] hover:border-muted-foreground max-[680px]:gap-2.5 max-[680px]:px-2.5 max-[680px]:py-2"
                        onClick={() => setSelectedTmdbId(m.tmdbId)}
                      >
                        <div className="flex w-[42px] shrink-0 flex-col items-center gap-0.5 max-[680px]:w-7">
                          <span
                            className={`w-[42px] shrink-0 text-center text-[22px] font-bold max-[680px]:w-5 max-[680px]:text-sm ${i === 0 ? "text-primary" : "text-muted-foreground"}`}
                          >
                            #{i + 1}
                          </span>
                          {mediaFiltersActive && originalRanks[m.tmdbId] !== undefined && originalRanks[m.tmdbId] !== i + 1 && (
                            <span
                              className="inline-flex items-center gap-[3px] whitespace-nowrap rounded-full border border-border bg-card px-2 py-[2px] text-[13px] font-bold text-primary max-[680px]:gap-0.5 max-[680px]:px-[5px] max-[680px]:py-px max-[680px]:text-[9px]"
                              title="Overall rank (group average, unfiltered)"
                            >
                              <span aria-hidden="true"><Globe size={11} /></span>
                              {originalRanks[m.tmdbId]}
                            </span>
                          )}
                        </div>
                        <div className="w-[62px] shrink-0 max-[680px]:w-12">
                          {m.posterUrl ? (
                            <img
                              className="block h-[93px] w-[62px] rounded-[6px] border border-muted-foreground object-cover max-[680px]:h-[72px] max-[680px]:w-12"
                              src={m.posterUrl}
                              alt={m.title}
                            />
                          ) : (
                            <div className="flex h-[93px] w-[62px] items-center justify-center rounded-[6px] border border-muted-foreground bg-card max-[680px]:h-[72px] max-[680px]:w-12">
                              <img src="/favicon.svg" alt="" className="h-2/5 w-2/5 opacity-40" />
                            </div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="truncate text-[17px] font-semibold text-foreground max-[680px]:line-clamp-2 max-[680px]:whitespace-normal max-[680px]:text-sm">
                            {m.title}
                            {m.year ? <span className="font-normal text-muted-foreground"> ({m.year})</span> : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-0 text-[13px] text-muted-foreground [&>*+*]:before:mx-1.5 [&>*+*]:before:inline-block [&>*+*]:before:content-['·'] max-[680px]:flex-col max-[680px]:items-start max-[680px]:gap-1 max-[680px]:[&>*+*]:before:mx-0 max-[680px]:[&>*+*]:before:content-none">
                            <span className="mr-1.5 rounded-full border border-border bg-card px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground max-[680px]:mr-0">
                              {m.type}
                            </span>
                            {m.runtimeMinutes ? (
                              <span className="whitespace-nowrap">{formatWatchTime(m.runtimeMinutes)}</span>
                            ) : null}
                          </span>
                          <VotingStatusBadge media={m} />
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="text-[19px] font-bold text-primary max-[680px]:text-[13px]">
                            {displayRating !== null ? `★ ${displayRating.toFixed(1)}` : "—"}
                          </span>
                          {rankingMemberId === "average" ? (
                            <span className="whitespace-nowrap text-[13px] text-foreground">
                              {ratedCount}/{watchedList.length} rated
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-[3px] whitespace-nowrap rounded-full border border-border bg-card px-2 py-[2px] text-[13px] font-bold text-primary max-[680px]:gap-0.5 max-[680px]:px-[5px] max-[680px]:py-px max-[680px]:text-[9px]"
                              title="Group average rating"
                            >
                              <span aria-hidden="true"><Globe size={11} /></span>
                              {m.averageRating !== null ? m.averageRating.toFixed(1) : "—"}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
              {mediaHasMore && <InfiniteScrollLoader sentinelRef={mediaSentinelRef} />}
          </div>

          <aside
            className={`sticky top-[78px] rounded-lg border border-border bg-muted p-4 shadow-lg max-[860px]:static max-[860px]:order-[-1] ${membersExpanded ? "max-[680px]:block" : "max-[680px]:hidden"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 text-[15px]">Members — {group.members.length + group.pendingMembers.length}</h2>
              <div className="flex items-center gap-2">
                <button data-slot="button"
                  type="button"
                  className="rounded-full border border-border bg-card px-[10px] py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() =>
                    setMemberSortMode((v) => (v === "az" ? "rating" : v === "rating" ? "watched" : "az"))
                  }
                  title="Cycle member sort: A-Z, average rating given, most watched"
                >
                  {memberSortMode === "rating" ? (
                    <>★ By rating</>
                  ) : memberSortMode === "watched" ? (
                    <>
                      <Eye size={13} className="inline-block align-[-2px] mr-1" /> Most watched
                    </>
                  ) : (
                    "A-Z"
                  )}
                </button>
                <button data-slot="button"
                  type="button"
                  className="hidden rounded-full border border-border bg-card px-[10px] py-1 text-[11px] font-semibold text-muted-foreground max-[860px]:inline-block"
                  onClick={() => setMembersExpanded((v) => !v)}
                >
                  {membersExpanded ? "Hide ▲" : "Show ▼"}
                </button>
              </div>
            </div>

            <div className={membersExpanded ? "max-[860px]:mt-3 max-[860px]:block max-[860px]:animate-[dropdown-pop-in_0.2s_ease_both]" : "max-[860px]:hidden"}>
              {isGroupOwner && (
                <div className="mb-[14px] border-b border-border/70 pb-[14px]">
                  <AddMemberDropdown users={nonMemberUsers} onAdd={addMember} />
                </div>
              )}

              <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto">
                {visibleMembers.map((m, mi) => {
                  const rowStyle = { animationDelay: `${Math.min(mi, 15) * 25}ms` };
                  if (m.kind === "pending") {
                    const stats = pendingStatsByDiscordId.get(m.discordId);
                    const label = m.displayName || m.discordId;
                    return (
                      <li
                        key={m.key}
                        className="group flex cursor-pointer items-center gap-3 rounded-[10px] border border-border/70 border-dashed bg-card px-[13px] py-[11px] opacity-85 transition-colors hover:border-primary hover:bg-secondary animate-[media-row-slide-in_0.3s_ease_both] motion-reduce:animate-none"
                        style={rowStyle}
                        onClick={() => setMemberModal(m)}
                      >
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-secondary text-[13px] font-bold text-muted-foreground"
                          title={`Discord id: ${m.discordId}`}
                        >
                          {label.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-px">
                          <span className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-base text-foreground">
                            {label}
                            <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                              Pending
                            </span>
                          </span>
                          {stats && (
                            <span className="overflow-visible whitespace-nowrap text-xs text-muted-foreground">
                              {stats.moviesWatched + stats.tvWatched} watched
                              {stats.averageRatingGiven !== null && ` · ★ ${stats.averageRatingGiven.toFixed(1)} avg`}
                            </span>
                          )}
                        </div>
                        {isGroupOwner && (
                          <button data-slot="button"
                            type="button"
                            className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-destructive hover:text-white [@media(hover:hover)]:opacity-0 [@media(hover:none),(pointer:coarse)]:h-[26px] [@media(hover:none),(pointer:coarse)]:w-[26px] [@media(hover:none),(pointer:coarse)]:opacity-[0.85]"
                            title="Remove pending member"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRemove({ kind: "pending", discordId: m.discordId, label });
                            }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </li>
                    );
                  }

                  const stats = memberStatsByUserId.get(m.userId);
                  return (
                    <li
                      key={m.key}
                      className="group flex cursor-pointer items-center gap-3 rounded-[10px] border border-border/70 bg-card px-[13px] py-[11px] transition-colors hover:border-primary hover:bg-secondary animate-[media-row-slide-in_0.3s_ease_both] motion-reduce:animate-none"
                      style={rowStyle}
                      onClick={() => setMemberModal(m)}
                    >
                      <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={40} online={isOnline(m.userId)} />
                      <div className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-base text-foreground">
                          {m.displayName}
                          {m.isOwner && (
                            <span
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[13px] leading-none"
                              title="Owner"
                            >
                              <Crown size={12} />
                            </span>
                          )}
                        </span>
                        {stats && (
                          <span className="overflow-visible whitespace-nowrap text-xs text-muted-foreground">
                            {stats.moviesWatched + stats.tvWatched} watched
                            {stats.averageRatingGiven !== null && ` · ★ ${stats.averageRatingGiven.toFixed(1)} avg`}
                          </span>
                        )}
                      </div>
                      {isGroupOwner && !m.isOwner && (
                        <button data-slot="button"
                          type="button"
                          className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-destructive hover:text-white [@media(hover:hover)]:opacity-0 [@media(hover:none),(pointer:coarse)]:h-[26px] [@media(hover:none),(pointer:coarse)]:w-[26px] [@media(hover:none),(pointer:coarse)]:opacity-[0.85]"
                          title="Remove member"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingRemove({ kind: "member", userId: m.userId, label: m.displayName });
                          }}
                        >
                          <X size={14} />
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
              <button data-slot="button" className="media-modal-close" onClick={requestClose} title="Close" type="button">
                <X size={18} />
              </button>
              <p className="mt-7 text-[15px] leading-normal">
                Remove <strong>{pendingRemove.label}</strong> from this group?
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (pendingRemove.kind === "member") removeMember(pendingRemove.userId);
                    else removePendingMember(pendingRemove.discordId);
                    requestClose();
                  }}
                >
                  Yes, remove
                </Button>
                <Button type="button" variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      <button data-slot="button"
        className={`fixed right-[56px] bottom-[72px] z-50 flex h-[44px] w-[44px] items-center justify-center rounded-full shadow-lg transition-all max-[680px]:right-6 max-[680px]:bottom-[92px] max-[680px]:h-10 max-[680px]:w-10 ${
          showScrollTop
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100 hover:scale-110"
            : "pointer-events-none translate-y-[14px] scale-[0.6] opacity-0"
        }`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        title="Scroll to top"
        aria-hidden={!showScrollTop}
        tabIndex={showScrollTop ? 0 : -1}
      >
        <ArrowUp size={18} />
      </button>

      {pendingImportFile && (
        <Modal modalClassName="media-modal confirm-modal" onClose={cancelImport}>
          {(requestClose) => (
            <>
              <h2 className="mt-0">Import "{pendingImportFile.name}"?</h2>
              <p className="text-[13px] text-muted-foreground">
                This overwrites the group's media, reviews, and watch statuses. Can't be undone.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="button" onClick={confirmImport}>Yes, import & overwrite</Button>
                <Button type="button" variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
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
