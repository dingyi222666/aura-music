import { useEffect, useState } from "react";

const visible = () => {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
};

export const usePageActive = () => {
  const [active, setActive] = useState(visible);

  useEffect(() => {
    const show = () => setActive(visible());
    const hide = () => setActive(false);

    show();
    window.addEventListener("pageshow", show);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", show);

    return () => {
      window.removeEventListener("pageshow", show);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", show);
    };
  }, []);

  return active;
};
