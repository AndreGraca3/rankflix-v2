import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Spinner } from "./Spinner";

export function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading, adminViewEnabled } = useAuth();

  if (loading) return <Spinner full />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && (user.role !== "admin" || !adminViewEnabled)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
