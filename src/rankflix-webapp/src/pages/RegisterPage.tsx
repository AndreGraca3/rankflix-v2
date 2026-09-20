import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(username, password, displayName);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <h1 className="m-0 text-[22px]">Create account</h1>
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
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9._-]+"
              title="Letters, numbers, dots, underscores and hyphens only"
            />
          </Label>
          <Label className="flex-col items-start gap-1.5 text-[13px] text-muted-foreground">
            Display name
            <Input
              type="text"
              name="display-name"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={1}
              maxLength={60}
            />
          </Label>
          <Label className="flex-col items-start gap-1.5 text-[13px] text-muted-foreground">
            Password
            <Input
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </Label>
          {error && <p className="mt-0 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Register"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
