"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type WatchTable = { table: string; filter?: string };

export function useLiveRefresh(params: { channelName: string; tables: WatchTable[]; onRefresh: () => void | Promise<void>; enabled?: boolean; debounceMs?: number }) {
  const { channelName, tables, onRefresh, enabled = true, debounceMs = 700 } = params;
  const refreshRef = useRef(onRefresh);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    if (!enabled || tables.length === 0) return;
    let mounted = true;
    const supabase = createClient();
    let channel: RealtimeChannel = supabase.channel(channelName);

    const scheduleRefresh = () => {
      if (!mounted) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (!mounted) return;
        if (runningRef.current) { pendingRef.current = true; return; }
        runningRef.current = true;
        try {
          await refreshRef.current();
        } finally {
          runningRef.current = false;
          if (pendingRef.current) {
            pendingRef.current = false;
            scheduleRefresh();
          }
        }
      }, debounceMs);
    };

    for (const watch of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: watch.table, ...(watch.filter ? { filter: watch.filter } : {}) },
        scheduleRefresh,
      );
    }
    channel.subscribe((status) => { if (status === "SUBSCRIBED") console.debug(`[realtime] ${channelName} subscribed`); });

    const onVisible = () => { if (document.visibilityState === "visible") scheduleRefresh(); };
    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("online", scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [channelName, debounceMs, enabled, JSON.stringify(tables)]);
}
