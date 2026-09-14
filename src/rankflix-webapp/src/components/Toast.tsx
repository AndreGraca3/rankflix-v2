import { useEffect } from "react";

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
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

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
