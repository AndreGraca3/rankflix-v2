import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Group } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { GroupPoster, GroupPosterEditor, GroupEditForm } from "../components/GroupEditor";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { useAuth } from "../auth/AuthContext";
import { useServerEvent } from "../hooks/useServerEvent";
import { useInfiniteList } from "../hooks/useInfiniteList";

export function DashboardPage() {
  const { user } = useAuth();
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

  const isAdmin = user?.role === "admin";
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
      <main className="page">
        <div className="page-header-row">
          <h1>Groups</h1>
          {!showCreateForm && (
            <button type="button" onClick={() => setShowCreateForm(true)}>
              + New group
            </button>
          )}
        </div>
        <div className="voting-filter-toggle" role="tablist" aria-label="Filter groups">
          <button type="button" className={viewFilter === "all" ? "active" : ""} onClick={() => setViewFilter("all")} title="All groups you belong to">
            All
          </button>
          <button type="button" className={viewFilter === "owner" ? "active" : ""} onClick={() => setViewFilter("owner")} title="Groups you own">
            👑 Owner
          </button>
          {isAdmin && (
            <button type="button" className={viewFilter === "system" ? "active" : ""} onClick={() => setViewFilter("system")} title="Every group in the system, including ones you don't belong to">
              🌐 All groups (system)
            </button>
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
                  ×
                </button>
                <form className="new-group-card" onSubmit={createGroup}>
                  <h2>New group</h2>
                  <div className="group-edit-poster-row">
                    <GroupPosterEditor imageUrl={newGroupImageUrl} name={newGroupName || "New group"} onChange={setNewGroupImageUrl} />
                  </div>
                  <div className="row">
                    <input
                      placeholder="New group name"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      autoFocus
                    />
                    <button type="submit">Create group</button>
                  </div>
                  <label className="file-input-label excel-btn new-group-import-label">
                    {newGroupImportFile ? `📄 ${newGroupImportFile.name} (import on create)` : "Or import from legacy .xlsx"}
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(e) => setNewGroupImportFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </form>
              </>
            )}
          </Modal>
        )}
        {loading && <Spinner />}
        {!loading && displayedGroups.length === 0 && (
          <EmptyState
            icon="🎬"
            title={viewFilter === "owner" ? "No groups owned" : "No groups yet"}
            subtitle={
              viewFilter === "owner"
                ? "You don't own any groups yet."
                : "You're not part of any group yet. Create one, or ask a friend to add you."
            }
          />
        )}
        <div className="group-grid">
          {visibleGroups.map((g) => (
            <div className="group-card" key={g.id}>
              <Link to={`/groups/${g.id}`} className="group-card-link">
                <div className="group-poster-wrap">
                  <GroupPoster imageUrl={g.imageUrl} name={g.name} />
                  {isGroupOwner(g) && (
                    <>
                      <button
                        type="button"
                        className="group-edit-btn"
                        title="Edit group"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingId(g.id);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="group-delete-overlay-btn"
                        title="Delete group"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeletingId(g.id);
                        }}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
                <div className="group-card-info">
                  <span className="group-card-name">{g.name}</span>
                  <span className="muted">{g.members.length + g.pendingMembers.length} members</span>
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
                  ×
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
                  onDeleteRequested={() => { setEditingId(null); setDeletingId(editingGroup.id); }}
                />
              </>
            )}
          </Modal>
        )}
        {deletingGroup && (
          <Modal
            overlayClassName="comment-modal-overlay"
            modalClassName="comment-modal confirm-modal"
            onClose={() => setDeletingId(null)}
          >
            {(requestClose) => (
              <>
                <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                  ×
                </button>
                <p>
                  Delete <strong>{deletingGroup.name}</strong>? This permanently removes the group, its media,
                  reviews, and watch history. This can't be undone.
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
      </main>
      {error && <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />}
      {successToast && (
        <Toast variant="success" title={successToast} duration={4000} onClose={() => setSuccessToast(null)} style={{ top: 24 + (error ? 86 : 0) }} />
      )}
    </div>
  );
}
