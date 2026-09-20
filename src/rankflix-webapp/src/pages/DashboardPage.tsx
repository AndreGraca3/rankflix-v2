import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Crown, Globe, Clapperboard, Pencil, Trash2, FileText, X } from "lucide-react";
import { api } from "../api/client";
import type { Group } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Toast } from "../components/Toast";
import { GroupPoster, GroupPosterEditor, GroupEditForm } from "../components/GroupEditor";
import { GroupCardSkeleton } from "../components/GroupCardSkeleton";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { useAuth } from "../auth/AuthContext";
import { useServerEvent } from "../hooks/useServerEvent";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export function DashboardPage() {
  const { user, adminViewEnabled } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupImageUrl, setNewGroupImageUrl] = useState("");
  const [newGroupImportFile, setNewGroupImportFile] = useState<File | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [viewFilter, setViewFilter] = useState<"all" | "owner" | "system">("all");

  const load = (filter: "all" | "owner" | "system") => {
    setLoading(true);
    const url = filter === "system" ? "/api/groups/all" : "/api/groups";
    api
      .get<Group[]>(url)
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load groups"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(viewFilter), [viewFilter]);

  // If the admin switches to "User view" mid-session while on the admin-only "system" tab,
  // fall back to "all" so the (now hidden) tab's data isn't left showing.
  useEffect(() => {
    if (viewFilter === "system" && !(user?.role === "admin" && adminViewEnabled)) setViewFilter("all");
  }, [adminViewEnabled, user?.role, viewFilter]);

  // A group was created/renamed for us, or our discord id got attached to new group
  // history - refetch the list so it shows up without a manual page reload.
  useServerEvent("groups-changed", () => load(viewFilter));
  useServerEvent("group-updated", () => load(viewFilter));

  // Pick up a toast handed to us from another page (e.g. GroupPage navigating here after an
  // optimistic group deletion), then clear it from history state so it doesn't reappear on
  // back/forward navigation or a refresh.
  useEffect(() => {
    const toast = (location.state as { toast?: { variant: "success" | "error"; title: string } } | null)?.toast;
    if (!toast) return;
    if (toast.variant === "error") setError(toast.title);
    else setSuccessToast(toast.title);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !user) return;
    setError(null);

    const trimmedName = newGroupName.trim();
    const trimmedImageUrl = newGroupImageUrl.trim() || null;
    const importFile = newGroupImportFile;
    const tempId = -Date.now();
    const optimisticGroup: Group = {
      id: tempId,
      name: trimmedName,
      ownerId: user.id,
      imageUrl: trimmedImageUrl,
      spinsDisabledForMembers: false,
      members: [{ userId: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, discordId: user.discordId, isOwner: true }],
      pendingMembers: [],
    };

    // Optimistic: show the new group card right away instead of waiting for the round-trip
    // (plus, when importing, the follow-up import call too).
    setGroups((cur) => [optimisticGroup, ...cur]);
    setNewGroupName("");
    setNewGroupImageUrl("");
    setNewGroupImportFile(null);
    setShowCreateForm(false);

    (async () => {
      try {
        const created = await api.post<Group>("/api/groups", { name: trimmedName, imageUrl: trimmedImageUrl });
        if (importFile) {
          const form = new FormData();
          form.append("file", importFile);
          await api.postForm(`/api/groups/${created.id}/excel/import`, form);
        }
        setGroups((cur) => cur.map((g) => (g.id === tempId ? created : g)));
        if (importFile) load(viewFilter); // pick up members/pending members the import added
      } catch (err) {
        setGroups((cur) => cur.filter((g) => g.id !== tempId));
        setError(err instanceof Error ? err.message : "Failed to create group");
      }
    })();
  };

  const isAdmin = user?.role === "admin" && adminViewEnabled;
  const isGroupOwner = (g: Group) => isAdmin || g.members.some((m) => m.userId === user?.id && m.isOwner);
  const displayedGroups = viewFilter === "owner" ? groups.filter(isGroupOwner) : groups;
  const editingGroup = editingId != null ? groups.find((g) => g.id === editingId) ?? null : null;
  const deletingGroup = deletingId != null ? groups.find((g) => g.id === deletingId) ?? null : null;

  const deleteGroup = () => {
    if (deletingId == null) return;
    const prevGroups = groups;
    const id = deletingId;
    const name = deletingGroup?.name;

    // Optimistic: remove the card immediately; restore it (and show an error) if the delete
    // turns out to have failed.
    setGroups((cur) => cur.filter((g) => g.id !== id));
    setDeletingId(null);

    api
      .delete(`/api/groups/${id}`)
      .then(() => setSuccessToast(name ? `"${name}" deleted` : "Group deleted"))
      .catch((err) => {
        setGroups(prevGroups);
        setError(err instanceof Error ? err.message : "Failed to delete group");
      });
  };

  const {
    visibleItems: visibleGroups,
    sentinelRef: groupsSentinelRef,
    hasMore: hasMoreGroups,
  } = useInfiniteList(displayedGroups, viewFilter);

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-[960px] px-6 py-8 pb-16">
        <div className="mb-7 flex items-center justify-between gap-3">
          <h1>Groups</h1>
          {!showCreateForm && <Button onClick={() => setShowCreateForm(true)}>+ New group</Button>}
        </div>
        <div
          className="flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card p-1"
          role="tablist"
          aria-label="Filter groups"
        >
          <Button
            type="button"
            variant={viewFilter === "all" ? "default" : "ghost"}
            size="sm"
            className="rounded-full font-semibold"
            onClick={() => setViewFilter("all")}
            title="All groups you belong to"
          >
            All
          </Button>
          <Button
            type="button"
            variant={viewFilter === "owner" ? "default" : "ghost"}
            size="sm"
            className="rounded-full font-semibold"
            onClick={() => setViewFilter("owner")}
            title="Groups you own"
          >
            <Crown size={14} /> Owner
          </Button>
          {isAdmin && (
            <Button
              type="button"
              variant={viewFilter === "system" ? "default" : "ghost"}
              size="sm"
              className="rounded-full font-semibold"
              onClick={() => setViewFilter("system")}
              title="Every group in the system, including ones you don't belong to"
            >
              <Globe size={14} /> All groups (system)
            </Button>
          )}
        </div>
        {showCreateForm && (
          <Modal
            modalClassName="media-modal group-edit-modal"
            onClose={() => {
              setShowCreateForm(false);
              setNewGroupName("");
              setNewGroupImageUrl("");
              setNewGroupImportFile(null);
            }}
          >
            {(requestClose) => (
              <>
                <button className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  <X size={18} />
                </button>
                <form className="mx-auto max-w-[420px]" onSubmit={createGroup}>
                  <h2>New group</h2>
                  <div className="mb-3.5 flex justify-center">
                    <GroupPosterEditor imageUrl={newGroupImageUrl} name={newGroupName || "New group"} onChange={setNewGroupImageUrl} />
                  </div>
                  <div className="my-3 flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="New group name"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      autoFocus
                    />
                    <Button type="submit">Create group</Button>
                  </div>
                  <label className="relative mt-2.5 inline-flex cursor-pointer items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                    {newGroupImportFile ? (
                      <>
                        <FileText size={14} className="mr-1 inline-block align-[-2px]" />
                        {newGroupImportFile.name} (import on create)
                      </>
                    ) : (
                      "Or import from legacy .xlsx"
                    )}
                    <input
                      type="file"
                      accept=".xlsx"
                      className="absolute inset-0 w-full cursor-pointer opacity-0"
                      onChange={(e) => setNewGroupImportFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </form>
              </>
            )}
          </Modal>
        )}
        {!loading && (
          <p className="my-2 mb-4 text-[13px] text-muted-foreground">
            {displayedGroups.length} group{displayedGroups.length === 1 ? "" : "s"}
          </p>
        )}
        {loading && (
          <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <GroupCardSkeleton key={i} />
            ))}
          </div>
        )}
        {!loading && displayedGroups.length === 0 && (
          <EmptyState
            icon={<Clapperboard size={40} />}
            title={viewFilter === "owner" ? "No groups owned" : "No groups yet"}
            subtitle={
              viewFilter === "owner"
                ? "You don't own any groups yet."
                : "You're not part of any group yet. Create one, or ask a friend to add you."
            }
          />
        )}
        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
          {!loading &&
            visibleGroups.map((g) => (
              <div className="group flex flex-col gap-2.5" key={g.id}>
                <Link
                  to={`/groups/${g.id}`}
                  className="flex flex-col gap-2.5 rounded-lg transition-transform [@media(hover:hover)]:hover:scale-[1.03]"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                    <GroupPoster imageUrl={g.imageUrl} name={g.name} />
                    {isGroupOwner(g) && (
                      <>
                        <button
                          type="button"
                          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full border border-border bg-black/70 text-foreground opacity-100 transition-colors [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:hover:bg-primary [@media(hover:hover)]:hover:text-primary-foreground"
                          title="Edit group"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingId(g.id);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full border border-border bg-black/70 text-foreground opacity-100 transition-colors [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:hover:bg-destructive [@media(hover:hover)]:hover:text-white"
                          title="Delete group"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeletingId(g.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{g.name}</span>
                    <span className="text-muted-foreground">{g.members.length + g.pendingMembers.length} members</span>
                  </div>
                </Link>
              </div>
            ))}
        </div>
        {hasMoreGroups && <InfiniteScrollLoader sentinelRef={groupsSentinelRef} />}
        {editingGroup && (
          <Modal modalClassName="media-modal group-edit-modal" onClose={() => setEditingId(null)}>
            {(requestClose) => (
              <>
                <button className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  <X size={18} />
                </button>
                <GroupEditForm
                  group={editingGroup}
                  onSaved={(patch) => {
                    setGroups((cur) => cur.map((g) => (g.id === editingGroup.id ? { ...g, ...patch } : g)));
                    setEditingId(null);
                  }}
                  onError={(message) => {
                    setError(message);
                    load(viewFilter);
                  }}
                  onCancel={requestClose}
                  onDeleteRequested={() => {
                    setEditingId(null);
                    setDeletingId(editingGroup.id);
                  }}
                />
              </>
            )}
          </Modal>
        )}
        {deletingGroup && (
          <Modal overlayClassName="comment-modal-overlay" modalClassName="comment-modal confirm-modal" onClose={() => setDeletingId(null)}>
            {(requestClose) => (
              <>
                <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                  <X size={18} />
                </button>
                <p className="mt-7 text-[15px] leading-normal">
                  Delete <strong>{deletingGroup.name}</strong>? This can't be undone.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="destructive" onClick={deleteGroup}>
                    Yes, delete
                  </Button>
                  <Button variant="outline" onClick={requestClose}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </Modal>
        )}
      </main>
      {error && <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />}
      {successToast && (
        <Toast variant="success" title={successToast} duration={4000} onClose={() => setSuccessToast(null)} style={{ top: 24 + (error ? 86 : 0) }} />
      )}
    </div>
  );
}
