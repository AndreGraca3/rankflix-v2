import { Loader2 } from "lucide-react";

export function Spinner({ full = false }: { full?: boolean }) {
  return (
    <div className={full ? "spinner-page" : "spinner-wrap"}>
      <Loader2 className="size-[26px] animate-spin text-[var(--accent)]" strokeWidth={2.5} aria-label="Loading" />
    </div>
  );
}
