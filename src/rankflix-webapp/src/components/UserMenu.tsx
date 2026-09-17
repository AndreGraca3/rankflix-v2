import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";

export function UserMenu() {
  const { user, logout, setStatus, adminViewEnabled, setAdminViewEnabled } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!user) return null;

  const handleSignOut = async () => {
    setOpen(false);
    await logout();
    navigate("/login");
  };

  const handleSetStatus = async (status: "online" | "invisible") => {
    if (status === user.status) {
      setStatusMenuOpen(false);
      setOpen(false);
      return;
    }
    setSavingStatus(true);
    try {
      await setStatus(status);
    } finally {
      setSavingStatus(false);
      setStatusMenuOpen(false);
      setOpen(false);
    }
  };

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="avatar-btn" title={user.displayName} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size={34} online={user.status === "online"} />
      </button>
      {open && (
        <ul className="user-menu-list">
          <li>
            <Link to="/profile" onClick={() => setOpen(false)}>
              Profile
            </Link>
          </li>
          {user.role === "admin" && (
            <li className="user-menu-admin-view-item">
              <button
                type="button"
                className="user-menu-admin-view-row"
                onClick={() => setAdminViewEnabled(!adminViewEnabled)}
                title={adminViewEnabled ? "Switch to User view (hides admin-only options)" : "Switch back to Admin view"}
              >
                <span>Admin view</span>
                <span className={`admin-view-switch${adminViewEnabled ? " on" : ""}`} aria-hidden="true">
                  <span className="admin-view-switch-knob" />
                </span>
              </button>
            </li>
          )}
          <li className="user-menu-status-item">
            <button
              type="button"
              className="user-menu-status-trigger"
              onClick={() => setStatusMenuOpen((o) => !o)}
              disabled={savingStatus}
            >
              <span className={`user-menu-status-dot${user.status === "online" ? " online" : " offline"}`} />
              {user.status === "online" ? "Online" : "Invisible"}
              <span className="user-menu-status-arrow">‹</span>
            </button>
            <ul className={`user-menu-status-flyout${statusMenuOpen ? " open" : ""}`}>
              <li>
                <button type="button" onClick={() => handleSetStatus("online")} disabled={savingStatus}>
                  <span className="user-menu-status-dot online" />
                  Online
                  {user.status === "online" && <span className="user-menu-status-check">✓</span>}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleSetStatus("invisible")} disabled={savingStatus}>
                  <span className="user-menu-status-dot offline" />
                  Invisible
                  {user.status === "invisible" && <span className="user-menu-status-check">✓</span>}
                </button>
              </li>
            </ul>
          </li>
          <li>
            <button type="button" className="user-menu-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
