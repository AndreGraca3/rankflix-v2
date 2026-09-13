import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page-viewport">
      <div className="auth-page">
        <div className="brand-mark">
          <img src="/favicon.svg" alt="" />
          <h1>Rankflix</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <button type="button" className="link-btn" onClick={() => setShowForgot(true)}>
          Forgot password?
        </button>
        {showForgot && (
          <div className="media-modal-overlay" onClick={() => setShowForgot(false)}>
            <div className="media-modal forgot-password-modal" onClick={(e) => e.stopPropagation()}>
              <button className="media-modal-close" title="Close" type="button" onClick={() => setShowForgot(false)}>
                ×
              </button>
              <h2>Forgot password?</h2>
              <p className="muted">
                Ask a group admin to reset your password for you — self-service reset isn't available yet.
              </p>
            </div>
          </div>
        )}
        <p>
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
