import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { loadInbox } from "@/services/inbox";
import { loadSentRequests } from "@/services/messageRequests";
import { requireSupabase } from "@/services/supabase";
import type { InboxConversation, SentRequest } from "@/types";

interface InboxValue {
  conversations: InboxConversation[];
  sentRequests: SentRequest[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
const Context = createContext<InboxValue | null>(null);

export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [sentRequests, setSentRequests] = useState<SentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const [inbox, sent] = await Promise.all([loadInbox(), loadSentRequests()]);
      if (!mounted.current || current !== revision.current) return;
      setConversations(inbox); setSentRequests(sent); setError(null);
    } catch {
      if (mounted.current && current === revision.current) setError("Couldn’t refresh your inbox. Check your connection and try again.");
    } finally {
      if (mounted.current && current === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      if (AppState.currentState !== "active") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, 150);
    };
    const client = requireSupabase();
    const channel = client.channel(`crossa-inbox-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests", filter: `sender_id=eq.${userId}` }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests", filter: `recipient_id=eq.${userId}` }, changed)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, changed)
      .subscribe((status) => { if (status === "SUBSCRIBED") changed(); });
    void refresh();
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    // Recovers missed events and failed subscriptions; never polls in the background.
    const poll = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 15000);
    return () => {
      mounted.current = false; revision.current++;
      if (timer) clearTimeout(timer);
      clearInterval(poll); foreground.remove(); void client.removeChannel(channel);
    };
  }, [refresh, userId]);

  return <Context.Provider value={{ conversations, sentRequests, loading, error, refresh }}>{children}</Context.Provider>;
}

export function useInbox() {
  const value = useContext(Context);
  if (!value) throw new Error("useInbox must be inside InboxProvider");
  return value;
}
