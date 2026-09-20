import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { UserDirectoryItem } from "../api/types";
import { Avatar } from "./Avatar";

interface AddMemberDropdownProps {
  users: UserDirectoryItem[];
  onAdd: (userId: number) => void;
}

export function AddMemberDropdown({ users, onAdd }: AddMemberDropdownProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <div className="add-member-dropdown">
        <DropdownMenuPrimitive.Trigger asChild>
          <button type="button" className="add-member-trigger">
            + Add member
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content className="add-member-list" side="top" align="start" sideOffset={6}>
            {users.length === 0 && <div className="add-member-empty muted">No users to add</div>}
            {users.map((u) => (
              <DropdownMenuPrimitive.Item key={u.id} className="outline-none" onSelect={() => onAdd(u.id)} asChild>
                <li>
                  <Avatar name={u.displayName} avatarUrl={u.avatarUrl} size={26} />
                  <span>{u.displayName}</span>
                </li>
              </DropdownMenuPrimitive.Item>
            ))}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </div>
    </DropdownMenuPrimitive.Root>
  );
}
