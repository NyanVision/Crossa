import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createNavigationContainerRef, type NavigatorScreenParams } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { DiscoverScreen } from "@/screens/discover/DiscoverScreen";
import { ProfileDetailScreen } from "@/screens/discover/ProfileDetailScreen";
import { MessagesScreen } from "@/screens/messages/MessagesScreen";
import { ChatScreen } from "@/screens/messages/ChatScreen";
import { MessageRequestScreen } from "@/screens/messages/MessageRequestScreen";
import { ProfileScreen } from "@/screens/profile/ProfileScreen";
import { EditProfileScreen } from "@/screens/profile/EditProfileScreen";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";
import { AboutYouSettingsScreen } from "@/screens/settings/AboutYouSettingsScreen";
import { ModerationQueueScreen } from "@/screens/settings/ModerationQueueScreen";
import { QrDiscoveryScreen } from "@/screens/discover/QrDiscoveryScreen";
import { useTheme } from "@/context/AppearanceContext";
import type { NearbyProfile } from "@/services/discovery";

export type AppStackParamList = {
  Discover: undefined;
  Messages: undefined;
  Profile: undefined;
  EditProfile: undefined;
  AboutYouSettings: undefined;
  ProfileDetail: { profile: NearbyProfile };
  Chat: { chatId: string };
  MessageRequestDetail: { requestId: string };
  Settings: undefined;
  ModerationQueue: undefined;
  QrDiscovery: { startInScan?: boolean } | undefined;
};

export type AppTabsParamList = {
  DiscoverTab: NavigatorScreenParams<AppStackParamList> | undefined;
  MessagesTab: NavigatorScreenParams<AppStackParamList> | undefined;
  ProfileTab: NavigatorScreenParams<AppStackParamList> | undefined;
};

export const appNavigationRef = createNavigationContainerRef<AppTabsParamList>();

const Tab = createBottomTabNavigator<AppTabsParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

function DiscoverStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, headerTitleStyle: { color: colors.text } }}>
      <Stack.Screen name="Discover" component={DiscoverScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProfileDetail" component={ProfileDetailScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="AboutYouSettings" component={AboutYouSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Edit profile" }} />
      <Stack.Screen name="QrDiscovery" component={QrDiscoveryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ModerationQueue" component={ModerationQueueScreen} options={{ title: "Moderation" }} />
    </Stack.Navigator>
  );
}
function MessagesStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, headerTitleStyle: { color: colors.text } }}>
      <Stack.Screen name="Messages" component={MessagesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.chatId })} />
      <Stack.Screen name="MessageRequestDetail" component={MessageRequestScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
function ProfileStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, headerTitleStyle: { color: colors.text } }}>
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Edit profile" }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="AboutYouSettings" component={AboutYouSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ModerationQueue" component={ModerationQueueScreen} options={{ title: "Moderation" }} />
    </Stack.Navigator>
  );
}

// Bottom tabs follow Android/iOS Material & HIG defaults automatically via
// @react-navigation/bottom-tabs (ripple on Android, translucent blur on iOS).
export function AppTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            DiscoverTab: "compass-outline",
            MessagesTab: "chatbubble-outline",
            ProfileTab: "person-outline",
          };
          return <Ionicons name={icons[route.name]} size={size ?? 21} color={color} />;
        },
      })}
    >
      <Tab.Screen name="DiscoverTab" component={DiscoverStack} options={{ title: "Discover" }} />
      <Tab.Screen name="MessagesTab" component={MessagesStack} options={{ title: "Inbox" }} />
      <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: "Profile" }} />
    </Tab.Navigator>
  );
}
