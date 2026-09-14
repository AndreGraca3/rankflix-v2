import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { UserListItem } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { Toast } from "../components/Toast";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { Modal } from "../components/Modal";
import { usePresence } from "../presence/PresenceContext";
import { useInfiniteList } from "../hooks/useInfiniteList";

export function UsersPage() {
  const { isOnline } = usePresence();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [toast, setToast] = useState<{ variant: "success" | "error"; title: string } | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDiscordId, setEditDiscordId] = useState("");
  const [editRole, setEditRole] = useState("member");
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
    setEditDisplayName(u.displayName);
    setEditDiscordId(u.discordId ?? "");
    setEditRole(u.role);
    setNewPassword(null);
    setConfirmingDelete(false);
  };

  const closeEdit = () => {
    setEditingUser(null);
  };

  const saveEdit = () => {
    if (!editingUser) return;
    const patch: Record<string, string> = {};
    if (editDisplayName !== editingUser.displayName) patch.displayName = editDisplayName;
    if (editDiscordId !== (editingUser.discordId ?? "")) patch.discordId = editDiscordId;
    if (editRole !== editingUser.role) patch.role = editRole;

    if (Object.keys(patch).length === 0) {
      setEditingUser(null);
      return;
    }

    const prevUsers = users;
    const userId = editingUser.id;
    // Optimistic: apply the patch and close the modal right away; revert + toast on failure.
    setUsers((cur) => cur.map((u) => (u.id === userId ? { ...u, ...patch, role: (patch.role ?? u.role) as UserListItem["role"] } : u)));
    setEditingUser(null);

    api
      .patch(`/api/users/${userId}`, patch)
      .then(() => setToast({ variant: "success", title: "User updated" }))
      .catch((e) => {
        setUsers(prevUsers);
        setToast({ variant: "error", title: e instanceof Error ? e.message : "Update failed" });
      });
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Display Name</th>
                  <th>Discord Id</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id} className="users-row" onClick={() => openEdit(u)}>
                    <td>
                      <Avatar name={u.displayName} avatarUrl={u.avatarUrl} size={28} online={isOnline(u.id)} />
                    </td>
                    <td>{u.displayName}</td>
                    <td>{u.discordId || <span className="muted">—</span>}</td>
                    <td>{u.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMoreUsers && <InfiniteScrollLoader sentinelRef={usersSentinelRef} />}
        </section>
      </main>

      {editingUser && (
        <Modal modalClassName="media-modal user-edit-modal" onClose={closeEdit}>
          {(requestClose) => (
            <>
              <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
                ×
              </button>
              <div className="user-edit-modal-header">
                <Avatar name={editingUser.displayName} avatarUrl={editingUser.avatarUrl} size={40} />
                <h2>{editingUser.displayName}</h2>
              </div>

              <label className="user-edit-field">
                <span className="muted">Display Name</span>
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Display name"
                  maxLength={60}
                />
              </label>

              <label className="user-edit-field">
                <span className="muted">Discord ID</span>
                <input
                  value={editDiscordId}
                  onChange={(e) => setEditDiscordId(e.target.value)}
                  placeholder="Discord ID"
                />
                <span className="user-edit-hint muted">
                  Reassigning this attaches any pending imported ratings/watch history for that Discord ID to this account.
                </span>
              </label>

              <label className="user-edit-field">
                <span className="muted">Role</span>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
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
                  <button type="button" className="btn-secondary" onClick={resetPassword}>
                    Reset password
                  </button>
                )}
              </div>

              <div className="row rating-modal-actions user-edit-actions-row">
                <button type="button" onClick={saveEdit}>
                  Save changes
                </button>
                <button type="button" className="btn-secondary" onClick={requestClose}>
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
            </>
          )}
        </Modal>
      )}

      {toast && <Toast variant={toast.variant} title={toast.title} onClose={() => setToast(null)} />}
    </div>
  );
}
