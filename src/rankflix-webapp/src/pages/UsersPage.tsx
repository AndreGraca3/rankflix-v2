import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "../api/client";
import type { UserListItem } from "../api/types";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { Toast } from "../components/Toast";
import { InfiniteScrollLoader } from "../components/InfiniteScrollLoader";
import { UserRowSkeleton } from "../components/UserRowSkeleton";
import { Modal } from "../components/Modal";
import { usePresence } from "../presence/PresenceContext";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function UsersPage() {
  const { isOnline } = usePresence();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      .catch((e) => setToast({ variant: "error", title: e instanceof Error ? e.message : "Failed to load users" }))
      .finally(() => setLoading(false));

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
      <main className="mx-auto max-w-[960px] px-6 py-8 pb-16">
        <h1>Users</h1>
        <p className="text-[13px] text-muted-foreground">
          Manage user accounts: reassign Discord IDs (e.g. when a friend switches accounts) and grant/revoke admin.
        </p>

        <section>
          <div className="overflow-x-auto">
            <table className="mb-4 w-full overflow-hidden rounded-lg border border-border bg-muted [border-collapse:collapse]">
              <thead>
                <tr>
                  <th className="border-b border-border/70 bg-card px-3.5 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"></th>
                  <th className="border-b border-border/70 bg-card px-3.5 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Display Name
                  </th>
                  <th className="border-b border-border/70 bg-card px-3.5 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Discord Id
                  </th>
                  <th className="border-b border-border/70 bg-card px-3.5 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Role
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 8 }).map((_, i) => <UserRowSkeleton key={i} />)}
                {!loading &&
                  visibleUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="cursor-pointer last:[&>td]:border-b-0 hover:bg-accent"
                      onClick={() => openEdit(u)}
                    >
                      <td className="border-b border-border/70 px-3.5 py-2.5 text-sm">
                        <Avatar name={u.displayName} avatarUrl={u.avatarUrl} size={28} online={isOnline(u.id)} />
                      </td>
                      <td className="border-b border-border/70 px-3.5 py-2.5 text-sm">{u.displayName}</td>
                      <td className="border-b border-border/70 px-3.5 py-2.5 text-sm">
                        {u.discordId || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="border-b border-border/70 px-3.5 py-2.5 text-sm">{u.role}</td>
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
                <X size={18} />
              </button>
              <div className="mb-4 flex items-center gap-3">
                <Avatar name={editingUser.displayName} avatarUrl={editingUser.avatarUrl} size={40} />
                <h2 className="m-0">{editingUser.displayName}</h2>
              </div>

              <Label className="mb-4 flex-col items-start gap-1.5">
                <span className="text-muted-foreground">Display Name</span>
                <Input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Display name"
                  maxLength={60}
                />
              </Label>

              <Label className="mb-4 flex-col items-start gap-1.5">
                <span className="text-muted-foreground">Discord ID</span>
                <Input value={editDiscordId} onChange={(e) => setEditDiscordId(e.target.value)} placeholder="Discord ID" />
                <span className="text-xs text-muted-foreground">
                  Reassigning this attaches any pending imported ratings/watch history for that Discord ID to this account.
                </span>
              </Label>

              <Label className="mb-4 flex-col items-start gap-1.5">
                <span className="text-muted-foreground">Role</span>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">member</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                  </SelectContent>
                </Select>
              </Label>

              <div className="mb-4 flex flex-col gap-1.5">
                <span className="text-muted-foreground">Password</span>
                {newPassword ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-muted-foreground">New password (copy now):</span>
                    <code className="rounded bg-white/[0.06] px-1.5 py-0.5">{newPassword}</code>
                    <Button type="button" variant="outline" onClick={() => setNewPassword(null)}>
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="self-start" onClick={resetPassword}>
                    Reset password
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={saveEdit}>
                  Save changes
                </Button>
                <Button type="button" variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
                <div className="ml-auto">
                  {confirmingDelete ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Delete this user permanently?</span>
                      <Button type="button" variant="destructive" onClick={deleteUser}>
                        Confirm delete
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
                      Delete user
                    </Button>
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
