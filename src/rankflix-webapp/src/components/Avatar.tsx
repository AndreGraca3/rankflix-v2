import { Avatar as AvatarPrimitive } from "radix-ui";

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
}

function initialsFor(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

// Built on Radix's Avatar primitive so a broken/expired image URL automatically falls back to
// the initials badge (Radix detects the image load error) instead of showing a broken-image icon,
// which the old plain <img> version didn't handle.
export function Avatar({ name, avatarUrl, size = 32, online }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.4) };
  const statusDot =
    online !== undefined ? (
      <span
        className={`avatar-status-dot${online ? " online" : " offline"}`}
        title={online ? "Online" : "Offline"}
      />
    ) : null;

  return (
    <span className="avatar-wrap">
      <AvatarPrimitive.Root className="avatar" style={style}>
        {avatarUrl && <AvatarPrimitive.Image className="size-full object-cover" src={avatarUrl} alt={name} />}
        <AvatarPrimitive.Fallback className="avatar-fallback flex size-full items-center justify-center" delayMs={avatarUrl ? 400 : 0}>
          {initialsFor(name)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {statusDot}
    </span>
  );
}
