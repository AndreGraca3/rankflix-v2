import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
    <div className="flex min-h-screen items-center justify-center px-4 py-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <h1 className="m-0 text-[22px]">Rankflix</h1>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <Label className="flex-col items-start gap-1.5 text-[13px] text-muted-foreground">
            Username
            <Input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </Label>
          <Label className="flex-col items-start gap-1.5 text-[13px] text-muted-foreground">
            Password
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Label>
          {error && <p className="mt-0 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <Button
          type="button"
          variant="link"
          className="mt-4 h-auto p-0"
          onClick={() => setShowForgot(true)}
        >
          Forgot password?
        </Button>
        {showForgot && (
          <Modal modalClassName="media-modal forgot-password-modal" onClose={() => setShowForgot(false)}>
            {(requestClose) => (
              <>
                <button className="media-modal-close" title="Close" type="button" onClick={requestClose}>
                  ×
                </button>
                <h2>Forgot password?</h2>
                <p className="text-[13px] text-muted-foreground">
                  Ask a group admin to reset your password for you — self-service reset isn't available yet.
                </p>
              </>
            )}
          </Modal>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
