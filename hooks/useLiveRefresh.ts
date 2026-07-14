"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type WatchTable = { table: string; filter?: string };
type LiveRefreshStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

type UseLiveRefreshParams = {
  channelName: string;
  tables: WatchTable[];
  onRefresh: () => void | Promise<void>;
  enabled?: boolean;
  debounceMs?: number;
  refreshOnSubscribed?: boolean;
  onStatus?: (status: LiveRefreshStatus) => void;
  onError?: (status: LiveRefreshStatus) => void;
};

export function useLiveRefresh(params: UseLiveRefreshParams) {
  const { channelName, tables, onRefresh, enabled = true, debounceMs = 700, refreshOnSubscribed = false, onStatus, onError } = params;
  const refreshRef = useRef(onRefresh);
  const statusRef = useRef(onStatus);
  const errorRef = useRef(onError);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => { refreshRef.current = onRefresh; statusRef.current = onStatus; errorRef.current = onError; }, [onRefresh, onStatus, onError]);

  useEffect(() => {
    if (!enabled || tables.length === 0) return;
    let mounted = true;
    const supabase = createClient();
    let channel: RealtimeChannel = supabase.channel(channelName);

    const runRefresh = async () => {
      if (!mounted) return;
      if (runningRef.current) { pendingRef.current = true; return; }
      runningRef.current = true;
      try {
        await refreshRef.current();
      } finally {
        runningRef.current = false;
        if (pendingRef.current && mounted) {
          pendingRef.current = false;
          scheduleRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (!mounted) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void runRefresh(); }, debounceMs);
    };

    for (const watch of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: watch.table, ...(watch.filter ? { filter: watch.filter } : {}) },
        scheduleRefresh,
      );
    }
    channel.subscribe((status) => {
      statusRef.current?.(status as LiveRefreshStatus);
      if (status === "SUBSCRIBED") {
        if (process.env.NODE_ENV !== "production") console.debug(`[realtime] ${channelName} subscribed`);
        if (refreshOnSubscribed) scheduleRefresh();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        errorRef.current?.(status as LiveRefreshStatus);
        if (process.env.NODE_ENV !== "production") console.warn(`[realtime] ${channelName} ${status}`);
      }
    });

    const onVisible = () => { if (document.visibilityState === "visible") scheduleRefresh(); };
    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      pendingRef.current = false;
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("online", scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [channelName, debounceMs, enabled, JSON.stringify(tables), refreshOnSubscribed]);
}
