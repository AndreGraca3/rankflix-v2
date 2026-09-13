import { useEffect, useState } from "react";
import { subscribeToPendingRequests } from "../api/client";

export function TopProgressBar() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    return subscribeToPendingRequests((count) => setActive(count > 0));
  }, []);

  if (!active) return null;

  return (
    <div className="top-progress">
      <div className="top-progress-track">
        <div className="top-progress-bar" />
      </div>
    </div>
  );
}
