import { useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { GroupMember, PendingGroupMember } from "../api/types";

interface RankingMemberSelectProps {
  members: GroupMember[];
  pendingMembers: PendingGroupMember[];
  value: number | string | "average";
  onChange: (value: number | string | "average") => void;
}

export function RankingMemberSelect({ members, pendingMembers, value, onChange }: RankingMemberSelectProps) {
  const [open, setOpen] = useState(false);

  const label =
    value === "average"
      ? "Group average"
      : typeof value === "number"
        ? `${members.find((m) => m.userId === value)?.displayName ?? "?"}'s ratings`
        : `${pendingMembers.find((p) => p.discordId === value)?.displayName ?? value}'s ratings`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={`ranking-member-trigger${open ? " open" : ""}`}
          title={`Ranking perspective: ${label}`}
        >
          <span className="ranking-member-trigger-icon" aria-hidden="true">🧭</span>
          <span className="ranking-member-trigger-label">{label}</span>
          <span className="ranking-member-trigger-chevron">▾</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="ranking-member-list" side="bottom" align="start" sideOffset={6} asChild>
          <ul>
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
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
