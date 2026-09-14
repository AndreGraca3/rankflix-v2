interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
}

function initialsFor(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export function Avatar({ name, avatarUrl, size = 32, online }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.4) };
  const statusDot =
    online !== undefined ? (
      <span
        className={`avatar-status-dot${online ? " online" : " offline"}`}
        title={online ? "Online" : "Offline"}
      />
    ) : null;

  if (avatarUrl) {
    return (
      <span className="avatar-wrap">
        <img className="avatar" src={avatarUrl} alt={name} style={style} />
        {statusDot}
      </span>
    );
  }

  return (
    <span className="avatar-wrap">
      <div className="avatar avatar-fallback" style={style}>
        {initialsFor(name)}
      </div>
      {statusDot}
    </span>
  );
}
