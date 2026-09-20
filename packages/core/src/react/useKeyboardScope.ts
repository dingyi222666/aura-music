import { useEffect, useId, useRef } from "react";
import { keyboardRegistry } from "../keyboardRegistry";

export const useKeyboardScope = (
  handler: (e: KeyboardEvent) => boolean | void,
  priority: number,
  active: boolean = true,
) => {
  const id = useId();
  // Keep handler ref to avoid re-registering on every render if handler identity changes
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;

    const wrappedHandler = (e: KeyboardEvent) => {
      return handlerRef.current(e);
    };

    keyboardRegistry.register(id, wrappedHandler, priority);
    return () => keyboardRegistry.unregister(id);
  }, [priority, active, id]);
};
