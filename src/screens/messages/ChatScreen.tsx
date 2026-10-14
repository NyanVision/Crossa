import React, { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { appendInboxMessage, loadConversationMessages, loadInbox, markInboxConversationRead, removeInboxConversation } from "@/services/inbox";
import { requireSupabase } from "@/services/supabase";
import { recordProfileReport, setProfileBlocked } from "@/services/profileSafety";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";
import type { ChatMessage, InboxConversation } from "@/types";

type Props = NativeStackScreenProps<AppStackParamList, "Chat">;

export function ChatScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const [conversation, setConversation] = useState<InboxConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: conversation?.displayName ?? "Private chat" });
  }, [conversation?.displayName, navigation]);

  useEffect(() => {
    let active = true;
    loadInbox().then(async (items) => {
      const found = items.find((item) => item.id === route.params.chatId && item.status === "chat") ?? null;
      if (!active) return;
      setConversation(found);
      if (found) {
        const savedMessages = await loadConversationMessages(found.id);
        if (!active) return;
        setMessages(savedMessages);
        void markInboxConversationRead(found.id);
      } else setMessages([]);
    }).catch(() => {
      if (active) {
        setConversation(null);
        setLoadFailed(true);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.params.chatId]);

  useEffect(() => {
    if (!conversation) return;
    const client = requireSupabase();
    const channel = client.channel(`catchya-messages-${conversation.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "messages",
        filter: `request_id=eq.${conversation.id}`,
      }, async (payload) => {
        const row = payload.new as { id: string; sender_id: string; body: string; created_at: string };
        const { data: { user } } = await client.auth.getUser();
        const message: ChatMessage = { id: row.id, from: row.sender_id === user?.id ? "me" : "them", text: row.body, createdAt: row.created_at };
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (user && row.sender_id !== user.id) void markInboxConversationRead(conversation.id);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [conversation?.id]);

  const send = async () => {
    const messageText = text.trim();
    if (!messageText || !conversation || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      const sentMessage = await appendInboxMessage(conversation.id, messageText);
      if (!sentMessage) {
        setSendFailed(true);
        return;
      }
      setMessages((current) => [...current, sentMessage]);
      setConversation((current) => current ? { ...current, lastMessage: messageText, updatedAt: sentMessage.createdAt ?? new Date().toISOString() } : current);
      setText("");
    } catch {
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  };

  const report = () => {
    if (!conversation) return;
    Alert.alert("Report this person?", `Report ${conversation.displayName} for review?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: async () => {
        try {
          await recordProfileReport(conversation.profileId);
          Alert.alert("Report saved", "Your report has been submitted for review.");
        } catch { Alert.alert("Report not saved", "Please try again."); }
      } },
    ]);
  };

  const block = () => {
    if (!conversation) return;
    Alert.alert("Block this person?", `${conversation.displayName} will be blocked on this device and this chat will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: async () => {
        try {
          await setProfileBlocked(conversation.profileId, true, conversation.displayName);
          await removeInboxConversation(conversation.id);
          navigation.goBack();
        } catch { Alert.alert("Couldn’t block profile", "Please try again."); }
      } },
    ]);
  };

  const openActions = () => Alert.alert(conversation?.displayName ?? "Chat options", undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Report", onPress: report },
    { text: "Block", style: "destructive", onPress: block },
  ]);

  if (loading) {
    return <View style={styles.stateScreen}><ActivityIndicator color={colors.accent} size="large" /><Text style={styles.stateTitle}>Loading chat…</Text><Text style={styles.stateCopy}>Your private conversation will appear here.</Text></View>;
  }

  if (!conversation) {
    return <View style={styles.stateScreen}><View style={styles.stateIcon}><Ionicons name={loadFailed ? "cloud-offline-outline" : "chatbubble-ellipses-outline"} size={27} color={colors.accent} /></View><Text style={styles.stateTitle}>{loadFailed ? "Couldn’t load this chat" : "Conversation unavailable"}</Text><Text style={styles.stateCopy}>{loadFailed ? "Check your connection and return to your inbox to try again." : "This conversation may have been removed or is no longer available."}</Text><Pressable onPress={() => navigation.goBack()} style={styles.backLink}><Text style={styles.backLinkText}>Back to inbox</Text></Pressable></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}>
      <View style={styles.personBar}>
        <ProfilePhoto uri={conversation.photoUri} />
        <View style={styles.personMeta}><Text style={styles.personName} numberOfLines={1}>{conversation.displayName}</Text><View style={styles.privateLine}><Ionicons name="lock-closed-outline" size={12} color={colors.success} /><Text style={styles.privateLabel}>Private chat</Text></View></View>
        <Pressable onPress={openActions} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Chat actions"><Ionicons name="ellipsis-horizontal" size={20} color={colors.text} /></Pressable>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={messages.length ? styles.messageList : styles.messageListEmpty}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <MessageBubble message={item} fallbackTime={conversation.updatedAt} />}
        ListEmptyComponent={<View style={styles.emptyMessages}><View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={24} color={colors.accent} /></View><Text style={styles.emptyTitle}>Your private chat is ready</Text><Text style={styles.emptyCopy}>Send a message to start chatting with {conversation.displayName}.</Text></View>}
      />

      {sendFailed ? <View style={styles.failedNotice}><Ionicons name="alert-circle-outline" size={17} color={colors.danger} /><Text style={styles.failedText}>Message didn’t send. Check your connection and try again.</Text><Pressable onPress={send} disabled={sending || !text.trim()} accessibilityRole="button" accessibilityLabel="Retry sending message"><Text style={styles.retryText}>{sending ? "Sending…" : "Retry"}</Text></Pressable></View> : null}

      <View style={styles.composerWrap}>
        <TextInput
        keyboardAppearance={isDark ? "dark" : "light"}
          value={text}
          onChangeText={(value) => { setText(value); setSendFailed(false); }}
          placeholder="Write a message…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          onSubmitEditing={send}
          returnKeyType="send"
          multiline
          maxLength={2000}
          accessibilityLabel="Message"
        />
        <Pressable style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]} onPress={send} accessibilityRole="button" accessibilityLabel="Send message" disabled={!text.trim() || sending}>
          {sending ? <ActivityIndicator color={colors.accentInk} size="small" /> : <Ionicons name="send" size={17} color={colors.accentInk} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ProfilePhoto({ uri }: { uri: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return uri
    ? <Image source={{ uri }} style={styles.photo} accessibilityLabel="Profile photo" />
    : <View style={[styles.photo, styles.photoPlaceholder]}><Ionicons name="person" size={20} color={colors.muted} /></View>;
}

function MessageBubble({ message, fallbackTime }: { message: ChatMessage; fallbackTime: string }) {
  const styles = useThemedStyles(makeStyles);
  const mine = message.from === "me";
  return <View style={[styles.messageBlock, mine ? styles.messageBlockMe : styles.messageBlockThem]}>
    <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleThem]}><Text style={mine ? styles.bubbleTextMe : styles.bubbleTextThem}>{message.text}</Text></View>
    <Text style={[styles.timestamp, mine ? styles.timestampMe : styles.timestampThem]}>{formatMessageTime(message.createdAt ?? fallbackTime)}</Text>
  </View>;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  personBar: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  photo: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.borderSoft },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  personMeta: { flex: 1, minWidth: 0 },
  personName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  privateLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  privateLabel: { color: colors.success, fontSize: 11, fontWeight: "700" },
  menuButton: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  messageList: { flexGrow: 1, padding: 16, paddingBottom: 20, gap: 10 },
  messageListEmpty: { flexGrow: 1, justifyContent: "center", padding: 22 },
  messageBlock: { maxWidth: "82%" },
  messageBlockMe: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageBlockThem: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleThem: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 },
  bubbleMe: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  bubbleTextThem: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bubbleTextMe: { color: colors.accentInk, fontSize: 14, lineHeight: 20 },
  timestamp: { fontSize: 10, marginTop: 4, marginHorizontal: 3 },
  timestampThem: { color: colors.muted },
  timestampMe: { color: colors.muted },
  emptyMessages: { alignItems: "center", padding: 18, maxWidth: 330, alignSelf: "center" },
  emptyIcon: { width: 56, height: 56, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyCopy: { color: colors.muted, fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 6 },
  failedNotice: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.dangerSoft, borderTopWidth: 1, borderTopColor: "#F5D6D2" },
  failedText: { flex: 1, color: colors.danger, fontSize: 11, lineHeight: 15 },
  retryText: { color: colors.accent, fontSize: 12, fontWeight: "800", padding: 4 },
  composerWrap: { flexDirection: "row", alignItems: "flex-end", gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.background },
  input: { flex: 1, maxHeight: 110, minHeight: 43, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 10, fontSize: 14, lineHeight: 19, color: colors.text, backgroundColor: colors.surface },
  sendButton: { width: 43, height: 43, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.45 },
  stateScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: colors.background },
  stateIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  stateTitle: { color: colors.text, fontWeight: "800", fontSize: 15, marginTop: 12, textAlign: "center" },
  stateCopy: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: "center", maxWidth: 280 },
  backLink: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  backLinkText: { color: colors.accent, fontSize: 12, fontWeight: "800" },
});
