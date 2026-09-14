import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { NavBar } from "../components/NavBar";
import { Avatar } from "../components/Avatar";
import { ImageUploadButton } from "../components/ImageUploadButton";
import { Toast } from "../components/Toast";
import { api } from "../api/client";
import type { UserStats } from "../api/types";

export function ProfilePage() {
  const { user, updateProfile, changePassword } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
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

  const accountDirty =
    username !== user.username || displayName !== user.displayName || avatarUrl !== user.avatarUrl;

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setAccountSubmitting(true);
    try {
      const patch: { username?: string; displayName?: string; avatarUrl?: string } = {};
      if (username !== user.username) patch.username = username;
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
      <main className="page page-narrow">
        <div className="profile-sections">
        <div className="card account-card">
          <h2>Account</h2>
          <form onSubmit={handleAccountSubmit}>
            <div className="account-identity-row">
              <ImageUploadButton
                aspect={1}
                round
                onImage={(dataUrl) => setAvatarUrl(dataUrl)}
                renderTrigger={(open) => (
                  <button type="button" className="avatar-edit-trigger" onClick={open} title="Change avatar">
                    <Avatar name={displayName || user.displayName} avatarUrl={avatarUrl} size={96} />
                    <span className="avatar-edit-overlay">✎</span>
                  </button>
                )}
              />
              <div className="account-identity-info">
                <label>
                  Display name
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    minLength={1}
                    maxLength={60}
                  />
                </label>
                <div className="badge-row">
                  <span className="badge">{user.role}</span>
                  {user.discordId && <span className="badge badge-outline">Discord: {user.discordId}</span>}
                </div>
              </div>
            </div>

            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={32}
                autoComplete="username"
              />
            </label>
            <p className="muted account-username-hint">Private — used only to sign in, never shown to other users.</p>

            <button type="submit" disabled={accountSubmitting || !accountDirty}>
              {accountSubmitting ? "Saving…" : "Save changes"}
            </button>
          </form>
        </div>

          <div className="profile-cards-row">
          {stats && (
          <div className="card stats-card">
            <h2>Your stats</h2>
            <div className="stats-grid">
              <div className="stat-tile">
                <span className="stat-value">{stats.totalGroups}</span>
                <span className="muted">Groups</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{stats.moviesWatched}</span>
                <span className="muted">Movies watched</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{stats.tvWatched}</span>
                <span className="muted">TV shows watched</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{stats.totalRatingsGiven}</span>
                <span className="muted">Ratings given</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">
                  {stats.averageRatingGiven !== null ? stats.averageRatingGiven.toFixed(1) : "—"}
                </span>
                <span className="muted">Avg rating given</span>
              </div>
            </div>
            {stats.topRated && (
              <div className="stats-top-rated">
                {stats.topRated.posterUrl && (
                  <img src={stats.topRated.posterUrl} alt={stats.topRated.title} className="stats-top-rated-poster" />
                )}
                <div>
                  <span className="muted">Your top rated</span>
                  <p className="stats-top-rated-title">
                    {stats.topRated.title} — ★ {stats.topRated.rating.toFixed(1)}
                  </p>
                </div>
              </div>
            )}
          </div>
          )}

        <div className="card">
          <h2>Change password</h2>
          <form onSubmit={handleChangePassword}>
            <label>
              Current password
              <input
                type="password"
                name="current-password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label>
              New password
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                name="confirm-new-password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {passwordError && <p className="error">{passwordError}</p>}
            {passwordSuccess && <p className="success">{passwordSuccess}</p>}
            <button type="submit" disabled={changingPassword}>
              {changingPassword ? "Changing..." : "Change password"}
            </button>
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
