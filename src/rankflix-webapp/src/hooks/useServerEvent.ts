import { useEffect } from "react";
import { eventStream } from "../api/eventStream";

/**
 * Subscribes to a named SSE event from the backend for the lifetime of the calling
 * component. `callback` should be stable-ish (an inline arrow is fine - the effect
 * re-subscribes on every render of the callback identity, which is cheap here).
 */
export function useServerEvent<T = unknown>(eventName: string, callback: (data: T) => void) {
  useEffect(() => {
    return eventStream.on(eventName, callback as (data: unknown) => void);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, callback]);
}
