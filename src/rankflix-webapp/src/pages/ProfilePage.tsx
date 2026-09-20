import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { ImageUploadButton } from "../components/ImageUploadButton";
import { Toast } from "../components/Toast";
import { StatsCardSkeleton } from "../components/StatsCardSkeleton";
import { api } from "../api/client";
import type { UserStats } from "../api/types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function ProfilePage() {
  const { user, updateProfile, changePassword } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api.get<UserStats>("/api/users/me/stats").then(setStats).catch(() => {});
  }, []);

  if (!user) return null;

  const accountDirty = displayName !== user.displayName || avatarUrl !== user.avatarUrl;

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setAccountSubmitting(true);
    try {
      const patch: { displayName?: string; avatarUrl?: string } = {};
      if (displayName !== user.displayName) patch.displayName = displayName;
      if (avatarUrl !== user.avatarUrl) patch.avatarUrl = avatarUrl ?? "";
      await updateProfile(patch);
      setSuccess("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setAccountSubmitting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords don't match");
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-[760px] px-6 py-8 pb-16 md:px-6">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2>Account</h2>
            <form onSubmit={handleAccountSubmit} className="flex flex-col gap-3.5">
              <div className="mb-7 flex items-center gap-4">
                <ImageUploadButton
                  aspect={1}
                  round
                  onImage={(dataUrl) => setAvatarUrl(dataUrl)}
                  renderTrigger={(open) => (
                    <button
                      type="button"
                      className="group relative h-[112px] w-[112px] shrink-0 rounded-full border-0 bg-none p-0"
                      onClick={open}
                      title="Change avatar"
                    >
                      <Avatar name={displayName || user.displayName} avatarUrl={avatarUrl} size={112} />
                      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-disabled:opacity-100">
                        <Pencil size={16} />
                      </span>
                    </button>
                  )}
                />
                <div className="min-w-0 flex-1">
                  <Label className="flex-col items-start gap-1.5 text-sm text-muted-foreground">
                    Display name
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                      minLength={1}
                      maxLength={60}
                    />
                  </Label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground capitalize">
                      {user.role}
                    </span>
                    {user.discordId && (
                      <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        Discord: {user.discordId}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <Label className="-mt-1.5 flex-col items-start gap-1.5 text-sm text-muted-foreground">
                Username
                <Input value={user.username} disabled autoComplete="username" />
              </Label>
              <p className="-mt-1.5 text-xs text-muted-foreground">
                Private — used only to sign in, never shown to other users. Can't be changed
                self-service; ask an admin if you need it updated.
              </p>

              <Button type="submit" disabled={accountSubmitting || !accountDirty} className="self-start">
                {accountSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </div>

          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
            {!stats && <StatsCardSkeleton />}
            {stats && (
              <div className="rounded-lg border border-border bg-card p-6 shadow-lg">
                <h2 className="mt-0 text-base">Your stats</h2>
                <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-3">
                  <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3 text-center">
                    <span className="text-[22px] font-bold text-primary">{stats.totalGroups}</span>
                    <span className="text-muted-foreground">Groups</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3 text-center">
                    <span className="text-[22px] font-bold text-primary">{stats.moviesWatched}</span>
                    <span className="text-muted-foreground">Movies watched</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3 text-center">
                    <span className="text-[22px] font-bold text-primary">{stats.tvWatched}</span>
                    <span className="text-muted-foreground">TV shows watched</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3 text-center">
                    <span className="text-[22px] font-bold text-primary">{stats.totalRatingsGiven}</span>
                    <span className="text-muted-foreground">Ratings given</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3 text-center">
                    <span className="text-[22px] font-bold text-primary">
                      {stats.averageRatingGiven !== null ? stats.averageRatingGiven.toFixed(1) : "—"}
                    </span>
                    <span className="text-muted-foreground">Avg rating given</span>
                  </div>
                </div>
                {stats.topRated && (
                  <div className="flex items-center gap-3 border-t border-border/70 pt-3">
                    {stats.topRated.posterUrl && (
                      <img
                        src={stats.topRated.posterUrl}
                        alt={stats.topRated.title}
                        className="h-[60px] w-10 rounded-md border border-border object-cover"
                      />
                    )}
                    <div>
                      <span className="text-muted-foreground">Your top rated</span>
                      <p className="mt-0.5 mb-0 font-semibold">
                        {stats.topRated.title} — ★ {stats.topRated.rating.toFixed(1)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border bg-card p-6 shadow-lg">
              <h2>Change password</h2>
              <form onSubmit={handleChangePassword} className="flex flex-col gap-3.5">
                <Label className="flex-col items-start gap-1.5 text-sm text-muted-foreground">
                  Current password
                  <Input
                    type="password"
                    name="current-password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </Label>
                <Label className="flex-col items-start gap-1.5 text-sm text-muted-foreground">
                  New password
                  <Input
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </Label>
                <Label className="flex-col items-start gap-1.5 text-sm text-muted-foreground">
                  Confirm new password
                  <Input
                    type="password"
                    name="confirm-new-password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </Label>
                {passwordError && <p className="text-destructive">{passwordError}</p>}
                {passwordSuccess && <p className="text-success">{passwordSuccess}</p>}
                <Button type="submit" disabled={changingPassword} className="self-start">
                  {changingPassword ? "Changing..." : "Change password"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </main>
      {error && <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />}
      {success && (
        <Toast
          variant="success"
          title={success}
          duration={4000}
          onClose={() => setSuccess(null)}
          style={error ? { top: 110 } : undefined}
        />
      )}
    </div>
  );
}
