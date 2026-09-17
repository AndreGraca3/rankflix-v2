import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { UserMenu } from "./UserMenu";

export function NavBar() {
  const { user, adminViewEnabled } = useAuth();

  return (
    <nav className="navbar">
      <div className="nav-left">
        <NavLink to="/" className="brand" end>
          <img src="/favicon.svg" alt="" />
          Rankflix
        </NavLink>
        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")} end>
            Groups
          </NavLink>
          {user?.role === "admin" && adminViewEnabled && (
            <NavLink to="/users" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              Users
            </NavLink>
          )}
        </div>
      </div>
      <UserMenu />
    </nav>
  );
}
