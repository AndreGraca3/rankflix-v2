import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { UserListItem } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { Toast } from "../components/Toast";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { usePresence } from "../presence/PresenceContext";
import { useInfiniteList } from "../hooks/useInfiniteList";

export function UsersPage() {
  const { isOnline } = usePresence();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [toast, setToast] = useState<{ variant: "success" | "error"; title: string } | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [editDiscordId, setEditDiscordId] = useState("");
  const [editRole, setEditRole] = useState("member");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const loadUsers = () =>
    api
      .get<UserListItem[]>("/api/users")
      .then(setUsers)
      .catch((e) => setToast({ variant: "error", title: e instanceof Error ? e.message : "Failed to load users" }));

  useEffect(() => {
    loadUsers();
  }, []);

  const {
    visibleItems: visibleUsers,
    sentinelRef: usersSentinelRef,
    hasMore: hasMoreUsers,
  } = useInfiniteList(users, null, 50);

  const openEdit = (u: UserListItem) => {
    setEditingUser(u);
    setEditDiscordId(u.discordId ?? "");
    setEditRole(u.role);
    setNewPassword(null);
    setConfirmingDelete(false);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditingUser(null);
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      if (editDiscordId !== (editingUser.discordId ?? "")) patch.discordId = editDiscordId;
      if (editRole !== editingUser.role) patch.role = editRole;

      if (Object.keys(patch).length > 0) {
        await api.patch(`/api/users/${editingUser.id}`, patch);
      }
      setToast({ variant: "success", title: "User updated" });
      setEditingUser(null);
      loadUsers();
    } catch (e) {
      setToast({ variant: "error", title: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!editingUser) return;
    try {
      const result = await api.post<{ newPassword: string }>(`/api/users/${editingUser.id}/reset-password`, {});
      setNewPassword(result.newPassword);
    } catch (e) {
      setToast({ variant: "error", title: e instanceof Error ? e.message : "Failed to reset password" });
    }
  };

  const deleteUser = async () => {
    if (!editingUser) return;
    const prevUsers = users;
    const userId = editingUser.id;
    setUsers((cur) => cur.filter((u) => u.id !== userId));
    setEditingUser(null);
    try {
      await api.delete(`/api/users/${userId}`);
      setToast({ variant: "success", title: "User deleted" });
    } catch (e) {
      setUsers(prevUsers);
      setToast({ variant: "error", title: e instanceof Error ? e.message : "Failed to delete user" });
    }
  };

  return (
    <div>
      <NavBar />
      <main className="page">
        <h1>Users</h1>
        <p className="muted">Manage user accounts: reassign Discord IDs (e.g. when a friend switches accounts) and grant/revoke admin.</p>

        <section>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Username</th>
                <th>Discord Id</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.id} className="users-row" onClick={() => openEdit(u)}>
                  <td>
                    <Avatar username={u.username} avatarUrl={u.avatarUrl} size={28} online={isOnline(u.id)} />
                  </td>
                  <td>{u.username}</td>
                  <td>{u.discordId || <span className="muted">—</span>}</td>
                  <td>{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMoreUsers && <InfiniteScrollLoader sentinelRef={usersSentinelRef} />}
        </section>
      </main>

      {editingUser && (
        <div className="media-modal-overlay" onClick={closeEdit}>
          <div className="media-modal user-edit-modal" onClick={(e) => e.stopPropagation()}>
            <button className="media-modal-close" onClick={closeEdit} title="Close" type="button" disabled={saving}>
              ×
            </button>
            <div className="user-edit-modal-header">
              <Avatar username={editingUser.username} avatarUrl={editingUser.avatarUrl} size={40} />
              <h2>{editingUser.username}</h2>
            </div>

            <label className="user-edit-field">
              <span className="muted">Discord ID</span>
              <input
                value={editDiscordId}
                onChange={(e) => setEditDiscordId(e.target.value)}
                placeholder="Discord ID"
                disabled={saving}
              />
              <span className="user-edit-hint muted">
                Reassigning this attaches any pending imported ratings/watch history for that Discord ID to this account.
              </span>
            </label>

            <label className="user-edit-field">
              <span className="muted">Role</span>
              <select value={editRole} onChange={(e) => setEditRole(e.target.value)} disabled={saving}>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <div className="user-edit-field">
              <span className="muted">Password</span>
              {newPassword ? (
                <div className="reset-password-result">
                  <span className="muted">New password (copy now):</span>
                  <code>{newPassword}</code>
                  <button type="button" className="btn-secondary" onClick={() => setNewPassword(null)}>
                    Dismiss
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-secondary" onClick={resetPassword} disabled={saving}>
                  Reset password
                </button>
              )}
            </div>

            <div className="row rating-modal-actions user-edit-actions-row">
              <button type="button" onClick={saveEdit} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="btn-secondary" onClick={closeEdit} disabled={saving}>
                Cancel
              </button>
              <div className="user-edit-danger-zone">
                {confirmingDelete ? (
                  <div className="row" style={{ gap: 8 }}>
                    <span className="muted">Delete this user permanently?</span>
                    <button type="button" className="danger" onClick={deleteUser}>
                      Confirm delete
                    </button>
                    <button type="button" className="secondary" onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>
                    Delete user
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast variant={toast.variant} title={toast.title} onClose={() => setToast(null)} />}
    </div>
  );
}
