import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { ExcelImportResult, Group, GroupMedia, GroupStats, MediaSearchResult, UserDirectoryItem } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { MediaAutocomplete } from "../components/MediaAutocomplete";
import { MediaDetailModal } from "../components/MediaDetailModal";
import { MemberDetailModal } from "../components/MemberDetailModal";
import { AddMemberDropdown } from "../components/AddMemberDropdown";
import { RankingMemberSelect } from "../components/RankingMemberSelect";
import { VotingStatusBadge } from "../components/VotingStatusBadge";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { GroupEditForm } from "../components/GroupEditor";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { useAuth } from "../auth/AuthContext";
import { usePresence } from "../presence/PresenceContext";
import { useServerEvent } from "../hooks/useServerEvent";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { formatWatchTime } from "../utils/time";

export function GroupPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { isOnline } = usePresence();
  const isAdmin = user?.role === "admin";
  const [group, setGroup] = useState<Group | null>(null);
  const [media, setMedia] = useState<GroupMedia[]>([]);
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

  const load = () => {
    if (!groupId) return;
    api.get<Group>(`/api/groups/${groupId}`).then(setGroup).catch((e) => setError(e.message));
    api
      .get<GroupMedia[]>(`/api/groups/${groupId}/media`)
      .then(setMedia)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load media"));
    api.get<GroupStats>(`/api/groups/${groupId}/stats`).then(setGroupStats).catch(() => {});
  };

  useEffect(load, [groupId]);

  // Any group/media/voting/rating mutation from anyone (including this same user in
  // another tab) re-fetches this group's data so everything stays live.
  useServerEvent<{ groupId?: number; tmdbId?: number }>("group-updated", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("media-added", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("media-removed", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("watcher-changed", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("rating-changed", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
  });
  useServerEvent<{ groupId?: number; tmdbId?: number }>("voting-duration-changed", (payload) => {
    if (String(payload?.groupId) === String(groupId)) load();
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

  useEffect(() => {
    const t = setTimeout(() => setMediaSearch(mediaSearchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [mediaSearchInput]);

  const filteredMedia = useMemo(() => {
    let list = media;
    if (votingFilter !== "all") {
      list = list.filter((m) => (votingFilter === "open" ? m.votingOpen : !m.votingOpen));
    }
    if (mediaSearch) {
      list = list.filter((m) => m.title.toLowerCase().includes(mediaSearch));
    }
    return list;
  }, [media, votingFilter, mediaSearch]);

  const rankedMedia = useMemo(() => {
    const hasWatched = (m: (typeof media)[number]): boolean =>
      typeof rankingMemberId === "number"
        ? m.watchers.some((w) => w.userId === rankingMemberId && w.hasWatched)
        : m.watchers.some((w) => w.discordId === rankingMemberId && w.hasWatched);
    const ratingOf = (m: (typeof media)[number]): number | null =>
      rankingMemberId === "average"
        ? m.averageRating
        : typeof rankingMemberId === "number"
          ? m.watchers.find((w) => w.userId === rankingMemberId)?.rating ?? null
          : m.watchers.find((w) => w.discordId === rankingMemberId)?.rating ?? null;
    const base = rankingMemberId === "average" ? filteredMedia : filteredMedia.filter(hasWatched);
    return [...base].sort((a, b) => {
      const aRating = ratingOf(a);
      const bRating = ratingOf(b);
      if (aRating === null && bRating === null) return 0;
      if (aRating === null) return 1;
      if (bRating === null) return -1;
      return bRating - aRating;
    });
  }, [filteredMedia, rankingMemberId]);

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
    | { kind: "real"; key: string; userId: number; username: string; avatarUrl: string | null; discordId: string | null; isOwner: boolean; averageRatingGiven: number | null; watchedCount: number }
    | { kind: "pending"; key: string; discordId: string; displayName: string | null; averageRatingGiven: number | null; watchedCount: number };

  const sortedMembers = useMemo((): SidebarMember[] => {
    if (!group) return [];
    const real: SidebarMember[] = group.members.map((m) => {
      const stats = memberStatsByUserId.get(m.userId);
      return {
        kind: "real",
        key: `u${m.userId}`,
        userId: m.userId,
        username: m.username,
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
    const nameOf = (m: SidebarMember) => (m.kind === "real" ? m.username : m.displayName || m.discordId).toLowerCase();
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

  const {
    visibleItems: visibleRankedMedia,
    sentinelRef: mediaSentinelRef,
    hasMore: hasMoreMedia,
  } = useInfiniteList(rankedMedia, `${votingFilter}|${mediaSearch}|${rankingMemberId}`);

  const {
    visibleItems: visibleMembers,
    sentinelRef: membersSentinelRef,
    hasMore: hasMoreMembers,
  } = useInfiniteList(sortedMembers, memberSortMode, 40);

  const computeAverage = (ratings: number[]): number | null =>
    ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const setWatched = async (tmdbId: number, userId: number, watched: boolean) => {
    const prevMedia = media;
    setMedia((cur) =>
      cur.map((m) => {
        if (m.tmdbId !== tmdbId) return m;
        // Un-marking as watched also clears any rating server-side, so mirror that here too.
        const watchers = m.watchers.map((w) =>
          w.userId === userId ? { ...w, hasWatched: watched, ...(watched ? {} : { rating: null, comment: null }) } : w
        );
        const ratings = watchers.map((w) => w.rating).filter((r): r is number => r !== null);
        return { ...m, watchers, averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null };
      })
    );
    try {
      await api.post(`/api/groups/${groupId}/media/${tmdbId}/watch/${userId}?watched=${watched}`);
      setSuccessToast(watched ? "Marked as watched" : "Removed watched status");
      load();
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
        return { ...m, watchers, averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null };
      })
    );
    try {
      await api.post(`/api/groups/${groupId}/media/${tmdbId}/watch-pending/${discordId}?watched=${watched}`);
      setSuccessToast(watched ? "Marked as watched" : "Removed watched status");
      load();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to update watch status");
    }
  };

  const submitRating = async (tmdbId: number, rating: number, comment?: string) => {
    const prevMedia = media;
    const myId = user?.id;
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
      setSuccessToast("Rating saved");
      load();
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
      setSuccessToast("Rating removed");
      load();
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
          { userId, username: userInfo.username, avatarUrl: userInfo.avatarUrl, discordId: null, isOwner: false },
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
          username: m.username,
          avatarUrl: m.avatarUrl,
          hasWatched: watchedByUserIds.includes(m.userId),
          rating: null,
          comment: null,
          isPending: false,
          discordId: m.discordId,
        })),
        ...group.pendingMembers.map((p) => ({
          userId: null,
          username: p.displayName || p.discordId,
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
      load();
    } catch (e) {
      setMedia(prevMedia);
      setError(e instanceof Error ? e.message : "Failed to update voting duration");
    }
  };

  const removeMedia = async (tmdbId: number) => {
    const prevMedia = media;
    setMedia((cur) => cur.filter((m) => m.tmdbId !== tmdbId));
    setSelectedTmdbId(null);
    try {
      await api.delete(`/api/groups/${groupId}/media/${tmdbId}`);
      setSuccessToast("Media removed");
      load();
    } catch (e) {
      setMedia(prevMedia);
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

        {groupStats && groupStats.totalWatchTimeMinutes > 0 && (
          <p className="group-watch-time-summary muted">
            ⏱ {formatWatchTime(groupStats.totalWatchTimeMinutes)} watched together so far
          </p>
        )}

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
                <p>
                  Delete <strong>{group.name}</strong>? This permanently removes the group, its media, reviews, and
                  watch history. This can't be undone.
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
                    <select value={newMedia.type} onChange={(e) => setNewMedia({ ...newMedia, type: e.target.value })}>
                      <option value="movie">movie</option>
                      <option value="tv">tv</option>
                    </select>
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
                              {m.username}
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
                  <div className="row">
                    <input
                      type="number"
                      min={1}
                      placeholder="Voting hours (default 24)"
                      value={newMedia.votingDurationHours}
                      onChange={(e) => setNewMedia({ ...newMedia, votingDurationHours: e.target.value })}
                    />
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

                <div className="voting-filter-toggle" role="tablist" aria-label="Filter by voting status">
                  <button type="button" className={votingFilter === "all" ? "active" : ""} onClick={() => setVotingFilter("all")}>
                    All
                  </button>
                  <button type="button" className={votingFilter === "open" ? "active" : ""} onClick={() => setVotingFilter("open")}>
                    Open
                  </button>
                  <button type="button" className={votingFilter === "closed" ? "active" : ""} onClick={() => setVotingFilter("closed")}>
                    Closed
                  </button>
                </div>
              </div>

              {isGroupOwner && !showAddMedia && (
                <button type="button" className="media-toolbar-add-btn" onClick={() => setShowAddMedia(true)}>
                  + Add media
                </button>
              )}
            </div>

            {media.length === 0 && (
              <EmptyState
                icon="🍿"
                title="No media in this group"
                subtitle="Add a movie or show above to start ranking and voting."
              />
            )}
            <ol className="media-ranking-list">
                {media.length > 0 && rankedMedia.length === 0 && mediaSearch && (
                  <p className="muted">No media matches "{mediaSearchInput}".</p>
                )}
                {visibleRankedMedia.map((m, i) => {
                  const watchedList = m.watchers.filter((w) => w.hasWatched);
                  const ratedCount = watchedList.filter((w) => w.rating !== null).length;
                  const displayRating =
                    rankingMemberId === "average"
                      ? m.averageRating
                      : typeof rankingMemberId === "number"
                        ? m.watchers.find((w) => w.userId === rankingMemberId)?.rating ?? null
                        : m.watchers.find((w) => w.discordId === rankingMemberId)?.rating ?? null;
                  return (
                    <li key={m.tmdbId}>
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
                          <span className="media-card-title">{m.title}</span>
                          <span className="media-ranking-meta muted">
                            <span className="media-ranking-meta-item">{m.type}</span>
                            <span className="media-ranking-meta-item">
                              {ratedCount}/{watchedList.length} rated
                            </span>
                            {m.runtimeMinutes ? (
                              <span className="media-ranking-meta-item">{formatWatchTime(m.runtimeMinutes)}</span>
                            ) : null}
                          </span>
                          <VotingStatusBadge media={m} />
                        </div>
                        <span className="media-ranking-score">
                          {displayRating !== null ? `★ ${displayRating.toFixed(1)}` : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {hasMoreMedia && <InfiniteScrollLoader sentinelRef={mediaSentinelRef} />}
          </div>

          <aside className="member-sidebar">
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
                {visibleMembers.map((m) => {
                  if (m.kind === "pending") {
                    const stats = pendingStatsByDiscordId.get(m.discordId);
                    const label = m.displayName || m.discordId;
                    return (
                      <li
                        key={m.key}
                        className="member-sidebar-row member-sidebar-row-pending member-sidebar-row-clickable"
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
                      className="member-sidebar-row member-sidebar-row-clickable"
                      onClick={() => setMemberModal(m)}
                    >
                      <Avatar username={m.username} avatarUrl={m.avatarUrl} size={40} online={isOnline(m.userId)} />
                      <div className="member-sidebar-info">
                        <span className="member-sidebar-name">
                          {m.username}
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
                            setPendingRemove({ kind: "member", userId: m.userId, label: m.username });
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
          name={memberModal.kind === "real" ? memberModal.username : memberModal.displayName || memberModal.discordId}
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
              <p>
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
              <p className="muted">
                This replaces this group's media list with the spreadsheet's: media, reviews, and watch statuses not
                found in the file will be removed, and everything in the file will be imported/updated. This can't be
                undone. Continue?
              </p>
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
          variant={importToast.unmatchedDiscordIds.length ? "warning" : "success"}
          title={`Imported ${importToast.mediaImported} media, ${importToast.reviewsImported} reviews, ${importToast.watchStatusesImported} watch statuses`}
          details={[
            ...(importToast.mediaRemoved
              ? [`Removed ${importToast.mediaRemoved} media that wasn't in the spreadsheet.`]
              : []),
            ...(importToast.unmatchedDiscordIds.length
              ? [
                  `Saved as pending for ${importToast.unmatchedDiscordIds.length} discord id(s) without an account yet — nothing was lost. Create their accounts and set their discord ID to attach it: ${importToast.unmatchedDiscordIds.join(", ")}`,
                ]
              : []),
          ]}
          duration={importToast.unmatchedDiscordIds.length ? 15000 : 8000}
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

