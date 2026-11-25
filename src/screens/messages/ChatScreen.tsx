import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useIsFocused } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { useReporting } from "@/context/ReportContext";
import { useInbox } from "@/context/InboxContext";
import { appendInboxMessage, loadConversationMessages, loadConversationState, loadConversationUpdates, loadInbox, markInboxConversationRead, setConversationTyping, type MessageCursor } from "@/services/inbox";
import { requireSupabase } from "@/services/supabase";
import { setProfileBlocked } from "@/services/profileSafety";
import { mergeMessages, serviceMessage } from "@/services/messageState";
import { type Palette } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";
import type { ChatMessage, InboxConversation } from "@/types";

type Props = NativeStackScreenProps<AppStackParamList, "Chat">;
export function ChatScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const { userId } = useAuth();
  const { report } = useReporting();
  const { refresh: refreshInbox } = useInbox();
  const focused = useIsFocused();
  const requestId = route.params.chatId;
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [conversation, setConversation] = useState<InboxConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [typingUntil, setTypingUntil] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const draft = useRef("");
  const pending = useRef<{ id: string; text: string } | null>(null);
  const cursor = useRef<MessageCursor | null>(null);
  const generation = useRef(0);
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const list = useRef<FlatList<ChatMessage>>(null);
  const stickToBottom = useRef(true);
  const lastKeystroke = useRef(0);
  const lastTypingSent = useRef(0);
  const wasTyping = useRef(false);
  const currentRequest = useRef(requestId);
  currentRequest.current = requestId;

  const replaceMessages = useCallback((next: ChatMessage[]) => { messagesRef.current = next; setMessages(next); }, []);
  const merge = useCallback((incoming: ChatMessage[]) => {
    const next = mergeMessages(messagesRef.current, incoming); messagesRef.current = next; setMessages(next);
  }, []);
  useLayoutEffect(() => { navigation.setOptions({ title: conversation?.displayName ?? "Private chat" }); }, [conversation?.displayName, navigation]);
  useEffect(() => { const sub = AppState.addEventListener("change", (state) => setForeground(state === "active")); return () => sub.remove(); }, []);
  useEffect(() => {
    setConversation(null); setText(""); draft.current = ""; pending.current = null;
    setSearch(""); setQuery(""); setSearchOpen(false); setPeerReadAt(null); setTypingUntil(null); setSendError(null);
  }, [requestId]);
  useEffect(() => { const timeout = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timeout); }, [search]);
  useEffect(() => {
    if (!typingUntil) return;
    const timeout = setTimeout(() => setTypingUntil(null), Math.max(0, new Date(typingUntil).getTime() - Date.now()));
    return () => clearTimeout(timeout);
  }, [typingUntil]);

  useEffect(() => {
    if (!focused || !foreground || !userId) return;
    let active = true;
    const version = ++generation.current;
    let refreshing = false;
    replaceMessages([]); cursor.current = null; setHasOlder(false); setLoading(true); setError(null);
    stickToBottom.current = !query;
    const state = async () => {
      const saved = await loadConversationState(requestId);
      if (active) { setPeerReadAt(saved.peerReadAt); setTypingUntil(saved.typingUntil); }
    };
    const refresh = async () => {
      if (refreshing || !active) return;
      refreshing = true;
      try {
        const items = await loadInbox();
        if (!active) return;
        const found = items.find((item) => item.id === requestId && item.status === "chat");
        if (!found) { setConversation(null); replaceMessages([]); setError("This conversation is no longer available."); return; }
        setConversation(found);
        const last = messagesRef.current.at(-1);
        if (!last?.createdAt || query) {
          const page = await loadConversationMessages(requestId, null, query);
          if (!active) return;
          replaceMessages(mergeMessages(page.messages, messagesRef.current)); cursor.current = page.cursor; setHasOlder(page.hasOlder);
        } else {
          let after = { id: last.id, createdAt: last.createdAt };
          for (let batch = 0; batch < 20 && active; batch++) {
            const page = await loadConversationUpdates(requestId, after);
            if (!active) return;
            merge(page.messages);
            const latest = page.messages.at(-1);
            if (!page.hasMore || !latest?.createdAt) break;
            after = { id: latest.id, createdAt: latest.createdAt };
            if (batch === 19) { // Very long absence: show a contiguous recent page.
              const recent = await loadConversationMessages(requestId);
              if (!active) return;
              replaceMessages(recent.messages); cursor.current = recent.cursor; setHasOlder(recent.hasOlder);
            }
          }
        }
        await state();
        if (!active) return;
        // Opening a search must not mark unseen newer messages as read.
        if (!query && stickToBottom.current) await markInboxConversationRead(requestId);
        if (active) setError(null);
      } catch (cause) {
        if (active) setError(serviceMessage(cause, "Couldn’t load messages. Check your connection and retry."));
      } finally { refreshing = false; if (active) setLoading(false); }
    };
    reloadRef.current = refresh;
    const client = requireSupabase();
    const channel = client.channel(`crossa-chat-${requestId}-${version}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `request_id=eq.${requestId}` }, (payload) => {
        if (!active) return;
        const row = payload.new as { id: string; sender_id: string; body: string; created_at: string };
        if (!query || row.body.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
          merge([{ id: row.id, from: row.sender_id === userId ? "me" : "them", text: row.body, createdAt: row.created_at }]);
        }
        if (row.sender_id !== userId && !query && stickToBottom.current) void markInboxConversationRead(requestId).catch(() => undefined);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "connection_requests", filter: `id=eq.${requestId}` }, () => { void state().catch(() => undefined); })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_activity", filter: `request_id=eq.${requestId}` }, () => { void state().catch(() => undefined); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
        if (active && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) setError("Connection interrupted. Messages will refresh automatically; you can also retry now.");
      });
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 15000);
    const typing = setInterval(() => {
      const shouldType = !!draft.current.trim() && Date.now() - lastKeystroke.current < 3500;
      if (shouldType || wasTyping.current) {
        wasTyping.current = shouldType;
        void setConversationTyping(requestId, shouldType).catch(() => undefined);
      }
    }, 3000);
    return () => {
      active = false; generation.current++; clearInterval(poll); clearInterval(typing);
      wasTyping.current = false; void setConversationTyping(requestId, false).catch(() => undefined);
      void client.removeChannel(channel);
    };
  }, [focused, foreground, requestId, userId, query, merge, replaceMessages]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !cursor.current) return;
    const version = generation.current; setLoadingOlder(true);
    try {
      const page = await loadConversationMessages(requestId, cursor.current, query);
      if (version !== generation.current) return;
      stickToBottom.current = false; merge(page.messages); cursor.current = page.cursor; setHasOlder(page.hasOlder);
    } catch (cause) { if (version === generation.current) setError(serviceMessage(cause, "Couldn’t load older messages.")); }
    finally { setLoadingOlder(false); }
  };
  const changeText = (value: string) => {
    setText(value); draft.current = value; setSendError(null); lastKeystroke.current = Date.now();
    if (focused && foreground && Date.now() - lastTypingSent.current > 3000) {
      lastTypingSent.current = Date.now(); wasTyping.current = !!value.trim();
      void setConversationTyping(requestId, wasTyping.current).catch(() => undefined);
    }
  };
  const send = async () => {
    const body = text.trim();
    if (!body || !conversation || sending) return;
    if (!pending.current || pending.current.text !== body) pending.current = { id: Crypto.randomUUID(), text: body };
    setSending(true); setSendError(null);
    try {
      const sent = await appendInboxMessage(requestId, body, pending.current.id);
      if (currentRequest.current !== requestId) return;
      if (!query || sent.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) merge([sent]);
      pending.current = null; changeText(""); stickToBottom.current = !query;
      void setConversationTyping(requestId, false).catch(() => undefined); void refreshInbox();
    } catch (cause) { setSendError(serviceMessage(cause, "Message didn’t send. Check your connection and retry.")); }
    finally { setSending(false); }
  };
  const openActions = () => {
    if (!conversation) return;
    Alert.alert(conversation.displayName, undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Search messages", onPress: () => setSearchOpen(true) },
      { text: "Report", onPress: () => report(conversation.profileId, conversation.displayName) },
      { text: "Block", style: "destructive", onPress: () => Alert.alert("Block this person?", "Their requests and chats will no longer be available.", [
        { text: "Cancel", style: "cancel" }, { text: "Block", style: "destructive", onPress: async () => {
          try { await setProfileBlocked(conversation.profileId, true); await refreshInbox(); navigation.goBack(); }
          catch { Alert.alert("Couldn’t block profile", "Please try again."); }
        } },
      ]) },
    ]);
  };
  const lastMine = [...messages].reverse().find((message) => message.from === "me")?.id;
  if (!conversation) return <View style={styles.state}><Ionicons name="chatbubbles-outline" size={30} color={colors.accent} /><Text style={styles.name}>{loading ? "Loading chat…" : "Conversation unavailable"}</Text>{error ? <Text style={styles.copy}>{error}</Text> : null}<Pressable onPress={() => void reloadRef.current()} style={styles.action}><Text style={styles.link}>Retry</Text></Pressable><Pressable onPress={() => navigation.goBack()} style={styles.action}><Text style={styles.link}>Back to inbox</Text></Pressable></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}>
    <View style={styles.personBar}>
      {conversation.photoUri ? <Image source={{ uri: conversation.photoUri }} style={styles.photo} /> : <View style={styles.photo}><Ionicons name="person" size={23} color={colors.muted} /></View>}
      <View style={{ flex: 1 }}><Text style={styles.name} numberOfLines={1}>{conversation.displayName}</Text><Text style={styles.copy}>Private chat</Text></View>
      <Pressable onPress={() => setSearchOpen(true)} accessibilityRole="button" accessibilityLabel="Search this chat" style={styles.action}><Ionicons name="search" size={20} color={colors.text} /></Pressable>
      <Pressable onPress={openActions} accessibilityRole="button" accessibilityLabel="Chat actions" style={styles.action}><Ionicons name="ellipsis-horizontal" size={22} color={colors.text} /></Pressable>
    </View>
    {searchOpen ? <View style={styles.searchBar}><TextInput accessibilityLabel="Search messages in this chat" value={search} onChangeText={setSearch} maxLength={100} placeholder="Search this conversation" placeholderTextColor={colors.muted} keyboardAppearance={isDark ? "dark" : "light"} style={styles.searchInput} autoFocus /><Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={() => { setSearch(""); setQuery(""); setSearchOpen(false); }} style={styles.action}><Ionicons name="close" size={22} color={colors.text} /></Pressable></View> : null}
    {error ? <View style={styles.notice}><Text style={styles.noticeText} accessibilityRole="alert">{error}</Text><Pressable onPress={() => void reloadRef.current()} style={styles.action}><Text style={styles.link}>Retry</Text></Pressable></View> : null}
    <FlatList ref={list} data={messages} keyExtractor={(message) => message.id} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onScroll={({ nativeEvent }) => {
        const bottom = nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height < 80;
        if (bottom && !stickToBottom.current && !query && focused && foreground) void markInboxConversationRead(requestId).catch(() => undefined);
        stickToBottom.current = bottom;
      }} scrollEventThrottle={150}
      onContentSizeChange={() => { if (stickToBottom.current) list.current?.scrollToEnd({ animated: false }); }}
      ListHeaderComponent={hasOlder ? <Pressable style={styles.action} onPress={() => void loadOlder()} disabled={loadingOlder} accessibilityRole="button"><Text style={styles.link}>{loadingOlder ? "Loading…" : "Load older messages"}</Text></Pressable> : null}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.empty}>{query ? "No matching messages." : "Your private chat is ready. Send a message to start."}</Text>}
      renderItem={({ item }) => <View style={[styles.message, item.from === "me" ? styles.mine : styles.theirs]}>
        <View style={[styles.bubble, item.from === "me" ? styles.bubbleMine : styles.bubbleTheirs]}><Text selectable style={[styles.body, item.from === "me" && styles.bodyMine]}>{item.text}</Text></View>
        <Text style={styles.timestamp}>{item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}{item.id === lastMine ? peerReadAt && new Date(peerReadAt).getTime() >= new Date(item.createdAt ?? "").getTime() ? " · Seen" : " · Sent" : ""}</Text>
      </View>} />
    {typingUntil && new Date(typingUntil).getTime() > Date.now() && !query ? <Text accessibilityLiveRegion="polite" style={styles.typing}>{conversation.displayName} is typing…</Text> : null}
    {sendError ? <View style={styles.notice}><Text style={styles.noticeText} accessibilityRole="alert">{sendError}</Text><Pressable onPress={() => void send()} disabled={sending} style={styles.action}><Text style={styles.link}>Retry</Text></Pressable></View> : null}
    <View style={styles.composer}><TextInput accessibilityLabel="Message" value={text} onChangeText={changeText} placeholder="Write a message…" placeholderTextColor={colors.muted} keyboardAppearance={isDark ? "dark" : "light"} maxLength={2000} multiline editable={!sending} style={styles.input} />
      <Pressable onPress={() => void send()} accessibilityRole="button" accessibilityLabel="Send message" disabled={!text.trim() || sending} style={[styles.send, (!text.trim() || sending) && { opacity: 0.45 }]}>{sending ? <ActivityIndicator color={colors.accentInk} /> : <Ionicons name="send" size={19} color={colors.accentInk} />}</Pressable>
    </View>
  </KeyboardAvoidingView>;
}
const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  personBar: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  photo: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  name: { color: colors.text, fontSize: 15, fontWeight: "800" }, copy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  action: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, justifyContent: "center", alignItems: "center" }, link: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  searchBar: { flexDirection: "row", alignItems: "center", margin: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  searchInput: { minHeight: 46, flex: 1, paddingHorizontal: 12, color: colors.text, fontSize: 14 },
  messages: { flexGrow: 1, padding: 16, gap: 10 }, message: { maxWidth: "85%" },
  mine: { alignSelf: "flex-end", alignItems: "flex-end" }, theirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 }, bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 5 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 }, bodyMine: { color: colors.accentInk }, timestamp: { color: colors.muted, fontSize: 10, marginTop: 4 },
  empty: { color: colors.muted, textAlign: "center", padding: 24, fontSize: 14, lineHeight: 21 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.dangerSoft }, noticeText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 },
  typing: { color: colors.muted, paddingHorizontal: 16, paddingVertical: 6, fontSize: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, color: colors.text, fontSize: 14, lineHeight: 20, padding: 12 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, justifyContent: "center", alignItems: "center" },
  state: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 12, backgroundColor: colors.background },
});
