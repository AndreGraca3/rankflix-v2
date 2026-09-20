import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";

export function UserMenu() {
  const { user, logout, setStatus, adminViewEnabled, setAdminViewEnabled } = useAuth();
  const navigate = useNavigate();
  const [savingStatus, setSavingStatus] = useState(false);

  if (!user) return null;

  const handleSignOut = async () => {
    await logout();
    navigate("/login");
  };

  const handleSetStatus = async (status: "online" | "invisible") => {
    if (status === user.status) return;
    setSavingStatus(true);
    try {
      await setStatus(status);
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button type="button" className="avatar-btn" title={user.displayName}>
          <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size={34} online={user.status === "online"} />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className="user-menu-list" side="bottom" align="end" sideOffset={10} asChild>
          <ul>
            <DropdownMenuPrimitive.Item asChild>
              <li>
                <Link to="/profile">Profile</Link>
              </li>
            </DropdownMenuPrimitive.Item>
            {user.role === "admin" && (
              <li className="user-menu-admin-view-item">
                <DropdownMenuPrimitive.Item
                  className="user-menu-admin-view-row"
                  onSelect={(e) => {
                    e.preventDefault();
                    setAdminViewEnabled(!adminViewEnabled);
                  }}
                  title={adminViewEnabled ? "Switch to User view (hides admin-only options)" : "Switch back to Admin view"}
                  asChild
                >
                  <button type="button">
                    <span>Admin view</span>
                    <span className={`admin-view-switch${adminViewEnabled ? " on" : ""}`} aria-hidden="true">
                      <span className="admin-view-switch-knob" />
                    </span>
                  </button>
                </DropdownMenuPrimitive.Item>
              </li>
            )}
            <li className="user-menu-status-item">
              <DropdownMenuPrimitive.Sub>
                <DropdownMenuPrimitive.SubTrigger className="user-menu-status-trigger" disabled={savingStatus} asChild>
                  <button type="button">
                    <span className={`user-menu-status-dot${user.status === "online" ? " online" : " offline"}`} />
                    {user.status === "online" ? "Online" : "Invisible"}
                    <span className="user-menu-status-arrow">‹</span>
                  </button>
                </DropdownMenuPrimitive.SubTrigger>
                <DropdownMenuPrimitive.Portal>
                  <DropdownMenuPrimitive.SubContent
                    className="user-menu-status-flyout open"
                    sideOffset={-6}
                    asChild
                  >
                    <ul>
                      <DropdownMenuPrimitive.Item asChild onSelect={() => handleSetStatus("online")}>
                        <li>
                          <button type="button" disabled={savingStatus}>
                            <span className="user-menu-status-dot online" />
                            Online
                            {user.status === "online" && <span className="user-menu-status-check">✓</span>}
                          </button>
                        </li>
                      </DropdownMenuPrimitive.Item>
                      <DropdownMenuPrimitive.Item asChild onSelect={() => handleSetStatus("invisible")}>
                        <li>
                          <button type="button" disabled={savingStatus}>
                            <span className="user-menu-status-dot offline" />
                            Invisible
                            {user.status === "invisible" && <span className="user-menu-status-check">✓</span>}
                          </button>
                        </li>
                      </DropdownMenuPrimitive.Item>
                    </ul>
                  </DropdownMenuPrimitive.SubContent>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Sub>
            </li>
            <DropdownMenuPrimitive.Item asChild onSelect={handleSignOut}>
              <li>
                <button type="button" className="user-menu-signout">
                  Sign out
                </button>
              </li>
            </DropdownMenuPrimitive.Item>
          </ul>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
