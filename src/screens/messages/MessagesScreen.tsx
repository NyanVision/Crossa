import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SignedProfileImage } from "@/components/SignedProfileImage";
import { useFocusEffect } from "@react-navigation/native";
import { loadInboxPage, type InboxCursor } from "@/services/inbox";
import { requireSupabase } from "@/services/supabase";
import { recordProfileReport, setProfileBlocked } from "@/services/profileSafety";
import type { InboxConversation, InboxStatus } from "@/types";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "Messages">;

export function MessagesScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState<InboxStatus>("chat");
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<InboxCursor | null>(null);

  const refresh = useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    loadInboxPage(null).then((page) => { if (active) { setConversations(page.conversations); setCursor(page.nextCursor); } })
      .catch(() => { if (active) setLoadError("Couldn’t load your inbox. Check your connection and retry."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useFocusEffect(refresh);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<ReturnType<typeof requireSupabase>["channel"]> | null = null;
    const client = requireSupabase();
    void client.auth.getUser().then(({ data: { user }, error }) => {
      if (!active || error || !user) return;
      const reloadInbox = () => {
        void loadInboxPage(null).then((page) => {
          if (active) { setConversations(page.conversations); setCursor(page.nextCursor); setLoadError(null); }
        }).catch(() => { if (active) setLoadError("Couldn’t refresh your inbox. Check your connection and retry."); });
      };
      channel = client.channel(`inbox:${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, reloadInbox)
        .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests" }, reloadInbox)
        .subscribe();
    });
    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loading) return;
    setLoadError(null);
    setLoadingMore(true);
    try {
      const page = await loadInboxPage(cursor);
      setConversations((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.conversations.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch { setLoadError("Couldn’t load older conversations. Tap to retry."); }
    finally { setLoadingMore(false); }
  }, [cursor, loadingMore, loading]);

  const chats = conversations.filter((item) => item.status === "chat");
  const requests = conversations.filter((item) => item.status === "request");
  const visible = tab === "chat" ? chats : requests;



  const openMenu = (conversation: InboxConversation) => Alert.alert(
    conversation.displayName,
    undefined,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Report", onPress: () => Alert.alert("Report profile?", `Report ${conversation.displayName} for review?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Report", style: "destructive", onPress: async () => {
          try {
            await recordProfileReport(conversation.profileId);
            Alert.alert("Report saved", "Your report has been submitted for review.");
          } catch { Alert.alert("Report not saved", "Please try again."); }
        } },
      ]) },
      { text: "Block", style: "destructive", onPress: async () => {
        try {
          await setProfileBlocked(conversation.profileId, true, conversation.displayName);
          setConversations((current) => current.filter((item) => item.id !== conversation.id));
        } catch { Alert.alert("Couldn’t block profile", "Please try again."); }
      } },
    ]
  );

  const onSelect = (conversation: InboxConversation) => {
    if (conversation.status === "request") {
      navigation.navigate("MessageRequestDetail", { requestId: conversation.id });
      return;
    }
    navigation.navigate("Chat", { chatId: conversation.id });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}><Text style={styles.title}>Inbox</Text><Text style={styles.subtitle}>Your chats and message requests</Text></View>
      <View style={styles.tabs}>
        <InboxTab label="Chats" count={chats.length} selected={tab === "chat"} onPress={() => setTab("chat")} />
        <InboxTab label="Requests" count={requests.length} selected={tab === "request"} onPress={() => setTab("request")} />
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={visible.length ? styles.list : styles.emptyList}
        renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => onSelect(item)} onMenu={() => openMenu(item)} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.35}
        ListHeaderComponent={loadError && conversations.length ? <Pressable onPress={() => void loadMore()}><Text style={styles.loadError}>{loadError} Retry</Text></Pressable> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 14 }} /> : null}
        ListEmptyComponent={<EmptyInbox tab={tab} loading={loading} error={loadError} retry={refresh} />}
      />
    </View>
  );
}

function InboxTab({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.tab, selected && styles.tabSelected]}><Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>{count > 0 ? <View style={[styles.countBadge, selected && styles.countBadgeSelected]}><Text style={[styles.countText, selected && styles.countTextSelected]}>{count}</Text></View> : null}</Pressable>;
}

function ConversationRow({ conversation, onPress, onMenu }: { conversation: InboxConversation; onPress: () => void; onMenu: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return <View style={styles.conversationCard}>
    <Pressable style={styles.conversationMain} onPress={onPress} accessibilityRole="button">
      <ProfilePhoto uri={conversation.photoUri} path={conversation.photoPath} size={50} />
      <View style={styles.messageMeta}>
        <View style={styles.nameLine}><Text style={[styles.name, conversation.unreadCount > 0 && styles.unreadText]} numberOfLines={1}>{conversation.displayName}</Text><Text style={styles.time}>{formatTime(conversation.updatedAt)}</Text></View>
        <View style={styles.previewLine}><Text style={[styles.preview, conversation.unreadCount > 0 && styles.unreadPreview]} numberOfLines={1}>{conversation.lastMessage || (conversation.status === "request" ? "Open to review this message request" : "No messages yet")}</Text>{conversation.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}</View>
      </View>
    </Pressable>
    <Pressable onPress={onMenu} style={styles.menuButton} accessibilityRole="button" accessibilityLabel={`More actions for ${conversation.displayName}`}><Ionicons name="ellipsis-vertical" size={18} color={colors.muted} /></Pressable>
  </View>;
}

function ProfilePhoto({ uri, path, size }: { uri: string | null; path?: string | null; size: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return uri ? <SignedProfileImage uri={uri} path={path} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.borderSoft }} accessibilityLabel="Profile photo" /> : <View style={[styles.photoPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}><Ionicons name="person" size={size * 0.43} color={colors.muted} /></View>;
}

function EmptyInbox({ tab, loading, error, retry }: { tab: InboxStatus; loading: boolean; error: string | null; retry: () => unknown }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const isChats = tab === "chat";
  return <View style={styles.emptyWrap}>
    <View style={styles.emptyIcon}><Ionicons name={loading ? "chatbubbles-outline" : isChats ? "chatbubble-ellipses-outline" : "mail-open-outline"} size={27} color={colors.accent} /></View>
    <Text style={styles.emptyTitle}>{loading ? "Loading inbox…" : error ? "Inbox unavailable" : isChats ? "No chats yet" : "No new requests"}</Text>
    <Text style={styles.emptyCopy}>{loading ? "Your conversations will appear here." : error ?? (isChats ? "When you accept a message request, your conversation will show up here." : "New message requests will appear here. They stay separate from your chats until you accept them.")}</Text>
    {error && !loading ? <Pressable onPress={() => { void retry(); }} style={styles.retryButton}><Text style={styles.retryLabel}>Retry</Text></Pressable> : null}
  </View>;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topbar: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  tabs: { flexDirection: "row", marginHorizontal: 16, padding: 4, borderRadius: 13, backgroundColor: colors.borderSoft, marginBottom: 8 },
  tab: { flex: 1, height: 39, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 10 },
  tabSelected: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  tabLabel: { color: colors.muted, fontSize: 12.5, fontWeight: "700" },
  tabLabelSelected: { color: colors.text },
  countBadge: { minWidth: 19, height: 19, paddingHorizontal: 5, borderRadius: 10, backgroundColor: colors.badge, alignItems: "center", justifyContent: "center" },
  countBadgeSelected: { backgroundColor: colors.accentSoft },
  countText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  countTextSelected: { color: colors.accent },
  list: { padding: 16, paddingTop: 8, paddingBottom: 28 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  conversationCard: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, padding: 12, marginBottom: 9, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  conversationMain: { flexDirection: "row", alignItems: "center", gap: 11, flex: 1, minWidth: 0 },
  photoPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: colors.borderSoft },
  messageMeta: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: "700" },
  unreadText: { fontWeight: "800" },
  time: { color: colors.muted, fontSize: 10.5 },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4 },
  preview: { color: colors.muted, fontSize: 11.5, flex: 1 },
  unreadPreview: { color: colors.text, fontWeight: "700" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  menuButton: { width: 30, height: 36, alignItems: "center", justifyContent: "center" },
  emptyWrap: { alignItems: "center", paddingHorizontal: 18, maxWidth: 340, alignSelf: "center" },
  emptyIcon: { width: 60, height: 60, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, marginBottom: 15 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyCopy: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 7, textAlign: "center" },
  loadError: { color: colors.danger, fontSize: 12, textAlign: "center", padding: 10 },
  retryButton: { marginTop: 14, paddingHorizontal: 18, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.accentSoft },
  retryLabel: { color: colors.accent, fontSize: 12, fontWeight: "800" },
});
