import { useEffect, useRef } from "react";

export function Toast({
  variant = "success",
  title,
  details,
  onClose,
  duration = 8000,
  style,
}: {
  variant?: "success" | "warning" | "error";
  title: string;
  details?: string[];
  onClose: () => void;
  /** ms before auto-dismiss, 0 disables */
  duration?: number;
  style?: React.CSSProperties;
}) {
  // Keep the latest onClose in a ref instead of the effect's dependency array - the parent
  // passes a brand-new inline closure on every render (e.g. GroupPage re-renders constantly
  // from SSE events/stat polling while a toast is showing), so depending on it directly would
  // reset this timer on every single re-render and the toast would effectively never auto-dismiss.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(t);
    // Restart the timer only when the toast's own content or duration actually changes (a new
    // message replacing the old one while still mounted), not on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, title]);

  return (
    <div className={`toast toast-${variant}`} role="status" style={style}>
      <div className="toast-icon">{variant === "success" ? "✓" : variant === "warning" ? "i" : "!"}</div>
      <div className="toast-body">
        <p className="toast-title">{title}</p>
        {details && details.length > 0 && (
          <ul className="toast-detail-list">
            {details.map((line, i) => (
              <li key={i} className="toast-detail">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
