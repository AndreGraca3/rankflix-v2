import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GroupMember, PendingGroupMember } from "../api/types";

interface RankingMemberSelectProps {
  members: GroupMember[];
  pendingMembers: PendingGroupMember[];
  value: number | string | "average";
  onChange: (value: number | string | "average") => void;
}

export function RankingMemberSelect({ members, pendingMembers, value, onChange }: RankingMemberSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest(".ranking-member-list")
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePos = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  const label =
    value === "average"
      ? "Group average"
      : typeof value === "number"
        ? `${members.find((m) => m.userId === value)?.displayName ?? "?"}'s ratings`
        : `${pendingMembers.find((p) => p.discordId === value)?.displayName ?? value}'s ratings`;

  return (
    <div className="ranking-member-dropdown" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className={`ranking-member-trigger${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={`Ranking perspective: ${label}`}
      >
        <span className="ranking-member-trigger-icon" aria-hidden="true">🧭</span>
        <span className="ranking-member-trigger-label">{label}</span>
        <span className="ranking-member-trigger-chevron">▾</span>
      </button>
      {open &&
        createPortal(
          <ul className="ranking-member-list ranking-member-list-portal" style={{ top: pos.top, left: pos.left }}>
            <li
              className={value === "average" ? "active" : ""}
              onClick={() => {
                onChange("average");
                setOpen(false);
              }}
            >
              Group average
            </li>
            {members.map((m) => (
              <li
                key={m.userId}
                className={value === m.userId ? "active" : ""}
                onClick={() => {
                  onChange(m.userId);
                  setOpen(false);
                }}
              >
                {m.displayName}'s ratings
              </li>
            ))}
            {pendingMembers.map((p) => (
              <li
                key={p.discordId}
                className={value === p.discordId ? "active" : ""}
                onClick={() => {
                  onChange(p.discordId);
                  setOpen(false);
                }}
              >
                {p.displayName ?? p.discordId}'s ratings
                <span className="member-pending-badge">Pending</span>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
