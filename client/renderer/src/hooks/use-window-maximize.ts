import { useCallback, useEffect, useState } from "react";

export function useWindowMaximize() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    void window.marloues.window.isMaximized().then((maximized) => {
      if (active) setIsMaximized(maximized);
    });
    const unsubscribe = window.marloues.window.onMaximizedChange(
      (maximized) => {
        setIsMaximized(maximized);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setMaximized = useCallback(async (maximized: boolean) => {
    setIsMaximized(maximized);
    const next = await window.marloues.window.setMaximized(maximized);
    setIsMaximized(next);
    return next;
  }, []);

  return { isMaximized, setMaximized };
}
