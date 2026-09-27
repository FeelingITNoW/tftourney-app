"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls the tournament page for changes made elsewhere (Discord check-ins,
// the bot recording a screenshot, etc.). Paused while the tab isn't visible
// so a background tab doesn't keep re-running the page's full server-side
// data fetch every 5s for no one to see; one refresh fires immediately when
// the tab becomes visible again to catch up on whatever changed while paused.
export function LiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;

    function start() {
      if (timer !== null) return;
      timer = window.setInterval(() => router.refresh(), 5000);
    }
    function stop() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, router]);
  return null;
}
