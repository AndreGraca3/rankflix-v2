import { useEffect, useRef, useState } from "react";
import type { UserDirectoryItem } from "../api/types";
import { Avatar } from "./Avatar";

interface AddMemberDropdownProps {
  users: UserDirectoryItem[];
  onAdd: (userId: number) => void;
}

export function AddMemberDropdown({ users, onAdd }: AddMemberDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="add-member-dropdown" ref={ref}>
      <button type="button" className="add-member-trigger" onClick={() => setOpen((o) => !o)}>
        + Add member
      </button>
      {open && (
        <ul className="add-member-list">
          {users.length === 0 && <li className="add-member-empty muted">No users to add</li>}
          {users.map((u) => (
            <li
              key={u.id}
              onClick={() => {
                onAdd(u.id);
                setOpen(false);
              }}
            >
              <Avatar username={u.username} avatarUrl={u.avatarUrl} size={26} />
              <span>{u.username}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
