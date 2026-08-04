import { useEffect, useRef } from "react";

/**
 * LIFO stack of Android system-back handlers.
 * A handler returns true if it consumed the event (e.g. closed a modal).
 */
type BackHandler = () => boolean;

const stack: BackHandler[] = [];

export function pushAndroidBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Run newest handler first; true if someone consumed back. */
export function consumeAndroidBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true;
    } catch {
      /* ignore broken handler */
    }
  }
  return false;
}

/**
 * Register a back handler while the component is mounted.
 * Keep the callback stable via ref so effect deps stay quiet.
 */
export function useAndroidBackHandler(handler: BackHandler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return pushAndroidBackHandler(() => handlerRef.current());
  }, [enabled]);
}
