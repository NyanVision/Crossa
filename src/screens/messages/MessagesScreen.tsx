import React, { useCallback, useState } from "react";
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { setProfileBlocked } from "@/services/profileSafety";
import { cancelMessageRequest } from "@/services/messageRequests";
import { serviceMessage } from "@/services/messageState";
import { useInbox } from "@/context/InboxContext";
import { useReporting } from "@/context/ReportContext";
import { Button } from "@/components/Button";
import type { InboxConversation, InboxStatus, SentRequest } from "@/types";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "Messages">;

export function MessagesScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const { conversations, sentRequests, loading, error, refresh } = useInbox();
  const { report } = useReporting();
  const [tab, setTab] = useState<InboxStatus | "sent">("chat");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const reload = async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };

  const chats = conversations.filter((item) => item.status === "chat");
  const requests = conversations.filter((item) => item.status === "request");
  const query = search.trim().toLocaleLowerCase();
  const visible = (tab === "chat" ? chats : requests).filter((item) => `${item.displayName} ${item.lastMessage}`.toLocaleLowerCase().includes(query));
  const visibleSent = sentRequests.filter((item) => `${item.displayName} ${item.status}`.toLocaleLowerCase().includes(query));



  const openMenu = (conversation: InboxConversation) => Alert.alert(
    conversation.displayName,
    undefined,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Report", onPress: () => report(conversation.profileId, conversation.displayName) },
      { text: "Block", style: "destructive", onPress: async () => {
        try {
          await setProfileBlocked(conversation.profileId, true, conversation.displayName);
          await refresh();
        } catch { Alert.alert("Couldn’t block profile", "Please try again."); }
      } },
    ]
  );

  const cancel = (request: SentRequest) => Alert.alert("Cancel this request?", `Your pending request to ${request.displayName} will be withdrawn.`, [
    { text: "Keep request", style: "cancel" },
    { text: "Cancel request", style: "destructive", onPress: async () => {
      setCancelling(request.id);
      try { await cancelMessageRequest(request.id); await refresh(); }
      catch (cause) { Alert.alert("Couldn’t cancel request", serviceMessage(cause, "Please try again.")); }
      finally { setCancelling(null); }
    } },
  ]);

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
      <View style={styles.searchWrap}><Ionicons name="search" size={18} color={colors.muted} /><TextInput accessibilityLabel="Search inbox" placeholder="Search people or messages" placeholderTextColor={colors.muted} keyboardAppearance={isDark ? "dark" : "light"} value={search} onChangeText={setSearch} maxLength={100} style={styles.searchInput} />{search ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} style={styles.clearSearch}><Ionicons name="close" size={20} color={colors.text} /></Pressable> : null}</View>
      <View style={styles.tabs}>
        <InboxTab label="Chats" count={chats.length} selected={tab === "chat"} onPress={() => setTab("chat")} />
        <InboxTab label="Requests" count={requests.length} selected={tab === "request"} onPress={() => setTab("request")} />
        <InboxTab label="Sent" count={sentRequests.filter((item) => item.status === "pending").length} selected={tab === "sent"} onPress={() => setTab("sent")} />
      </View>
      {error ? <View style={styles.errorNotice}><Text style={styles.errorText} accessibilityRole="alert">{error}</Text><Button label="Retry" onPress={() => void reload()} loading={refreshing} /></View> : null}
      {tab === "sent" ? <FlatList data={visibleSent} keyExtractor={(item) => item.id} refreshing={refreshing} onRefresh={() => void reload()} contentContainerStyle={visibleSent.length ? styles.list : styles.emptyList}
        renderItem={({ item }) => <View style={styles.conversationCard}>
          <ProfilePhoto uri={item.photoUri} size={44} /><View style={styles.messageMeta}><Text style={styles.name}>{item.displayName}</Text><Text style={styles.preview}>{item.status === "pending" ? "Waiting for a response" : item.status === "accepted" ? "Accepted · chat is ready" : item.status === "declined" ? "Declined" : "Cancelled"}</Text>{item.cooldownUntil && new Date(item.cooldownUntil).getTime() > Date.now() ? <Text style={styles.preview}>You can request again after {new Date(item.cooldownUntil).toLocaleString()}.</Text> : null}</View>
          {item.status === "pending" ? <Pressable disabled={cancelling !== null} onPress={() => cancel(item)} accessibilityRole="button" accessibilityLabel={`Cancel request to ${item.displayName}`} style={styles.cancelRequest}><Text style={styles.errorText}>{cancelling === item.id ? "Cancelling…" : "Cancel"}</Text></Pressable> : item.status === "accepted" ? <Pressable accessibilityRole="button" accessibilityLabel={`Chat with ${item.displayName}`} onPress={() => navigation.navigate("Chat", { chatId: item.id })} style={styles.cancelRequest}><Ionicons name="chatbubble-outline" size={22} color={colors.accent} /></Pressable> : null}
        </View>}
        ListEmptyComponent={error ? null : <Text style={styles.emptyCopy}>{loading ? "Loading sent requests…" : query ? "No matching sent requests." : "Requests you send will appear here with their status."}</Text>} /> : <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={() => void reload()}
        contentContainerStyle={visible.length ? styles.list : styles.emptyList}
        renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => onSelect(item)} onMenu={() => openMenu(item)} />}
        ListEmptyComponent={error ? null : query ? <Text style={styles.emptyCopy}>No matches for “{search.trim()}”.</Text> : <EmptyInbox tab={tab} loading={loading} />}
      />}
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
      <ProfilePhoto uri={conversation.photoUri} size={50} />
      <View style={styles.messageMeta}>
        <View style={styles.nameLine}><Text style={[styles.name, conversation.unreadCount > 0 && styles.unreadText]} numberOfLines={1}>{conversation.displayName}</Text><Text style={styles.time}>{formatTime(conversation.updatedAt)}</Text></View>
        <View style={styles.previewLine}><Text style={[styles.preview, conversation.unreadCount > 0 && styles.unreadPreview]} numberOfLines={1}>{conversation.lastMessage || (conversation.status === "request" ? "Open to review this message request" : "No messages yet")}</Text>{conversation.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}</View>
      </View>
    </Pressable>
    <Pressable onPress={onMenu} style={styles.menuButton} accessibilityRole="button" accessibilityLabel={`More actions for ${conversation.displayName}`}><Ionicons name="ellipsis-vertical" size={18} color={colors.muted} /></Pressable>
  </View>;
}

function ProfilePhoto({ uri, size }: { uri: string | null; size: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.borderSoft }} accessibilityLabel="Profile photo" /> : <View style={[styles.photoPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}><Ionicons name="person" size={size * 0.43} color={colors.muted} /></View>;
}

function EmptyInbox({ tab, loading }: { tab: InboxStatus; loading: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const isChats = tab === "chat";
  return <View style={styles.emptyWrap}>
    <View style={styles.emptyIcon}><Ionicons name={loading ? "chatbubbles-outline" : isChats ? "chatbubble-ellipses-outline" : "mail-open-outline"} size={27} color={colors.accent} /></View>
    <Text style={styles.emptyTitle}>{loading ? "Loading inbox…" : isChats ? "No chats yet" : "No new requests"}</Text>
    <Text style={styles.emptyCopy}>{loading ? "Your conversations will appear here." : isChats ? "When you accept a message request, your conversation will show up here." : "New message requests will appear here. They stay separate from your chats until you accept them."}</Text>
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
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  searchInput: { flex: 1, color: colors.text, minHeight: 44, fontSize: 14 },
  clearSearch: { padding: 10 },
  errorNotice: { marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 12, backgroundColor: colors.dangerSoft },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  cancelRequest: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center", alignItems: "center" },
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
});
