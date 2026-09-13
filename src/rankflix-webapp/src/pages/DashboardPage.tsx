import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupImageUrl, setNewGroupImageUrl] = useState("");
  const [newGroupImportFile, setNewGroupImportFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.post<Group>("/api/groups", {
        name: newGroupName.trim(),
        imageUrl: newGroupImageUrl.trim() || null,
      });
      if (newGroupImportFile) {
        const form = new FormData();
        form.append("file", newGroupImportFile);
        await api.postForm(`/api/groups/${created.id}/excel/import`, form);
      }
      setNewGroupName("");
      setNewGroupImageUrl("");
      setNewGroupImportFile(null);
      setShowCreateForm(false);
      load(viewFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  };

  const isAdmin = user?.role === "admin";
  const isGroupOwner = (g: Group) => isAdmin || g.members.some((m) => m.userId === user?.id && m.isOwner);
  const displayedGroups = viewFilter === "owner" ? groups.filter(isGroupOwner) : groups;
  const editingGroup = editingId != null ? groups.find((g) => g.id === editingId) ?? null : null;
  const deletingGroup = deletingId != null ? groups.find((g) => g.id === deletingId) ?? null : null;

  const deleteGroup = async () => {
    if (deletingId == null) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/api/groups/${deletingId}`);
      setDeletingId(null);
      load(viewFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete group");
    } finally {
      setDeleting(false);
    }
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
                    <button type="submit" disabled={creating}>
                      {creating ? "Creating..." : "Create group"}
                    </button>
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
                  onSaved={() => { setEditingId(null); load(viewFilter); }}
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
            disableBackdropClose={deleting}
          >
            {(requestClose) => (
              <>
                <button className="media-modal-close" onClick={requestClose} title="Close" type="button" disabled={deleting}>
                  ×
                </button>
                <p>
                  Delete <strong>{deletingGroup.name}</strong>? This permanently removes the group, its media,
                  reviews, and watch history. This can't be undone.
                </p>
                <div className="media-modal-confirm-delete confirm-modal-actions">
                  <button className="danger" onClick={deleteGroup} disabled={deleting}>
                    {deleting ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button className="secondary" onClick={requestClose} disabled={deleting}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </Modal>
        )}
      </main>
      {error && <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />}
    </div>
  );
}
