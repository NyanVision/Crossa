import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Platform } from "react-native";
import { WelcomeScreen } from "@/screens/auth/WelcomeScreen";
import { SignInScreen } from "@/screens/auth/SignInScreen";
import { CreateAccountScreen } from "@/screens/auth/CreateAccountScreen";
import { ResetPasswordScreen } from "@/screens/auth/ResetPasswordScreen";
import { PrivacyPolicyScreen } from "@/screens/auth/PrivacyPolicyScreen";
import { OnboardingScreen } from "@/screens/onboarding/OnboardingScreen";
import { AboutYouScreen } from "@/screens/onboarding/AboutYouScreen";
import { useTheme } from "@/context/AppearanceContext";

export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  CreateAccount: undefined;
  ResetPassword: undefined;
  PrivacyPolicy: undefined;
  AboutYou: undefined;
  Onboarding: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

// Header styling follows each platform's convention: large, left-aligned
// titles with a back chevron on iOS; centered titles with a back arrow and
// a subtle elevation line on Android (handled by the navigator defaults).
export function AuthNavigator({ signedInAsUser, onboardingStep = "about_you", recoveryMode = false }: { signedInAsUser: boolean; onboardingStep?: "about_you" | "profile"; recoveryMode?: boolean }) {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      key={recoveryMode ? "recovery" : signedInAsUser ? `onboarding-${onboardingStep}` : "signed-out"}
      initialRouteName={recoveryMode ? "ResetPassword" : signedInAsUser ? onboardingStep === "profile" ? "Onboarding" : "AboutYou" : "Welcome"}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: Platform.OS === "android",
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "800" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {recoveryMode ? (
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: "Choose a new password", headerBackVisible: false }} />
      ) : !signedInAsUser ? (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: "" }} />
          <Stack.Screen name="CreateAccount" component={CreateAccountScreen} options={{ title: "Create account" }} />
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: "Reset password" }} />
          <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
        </>
      ) : (
        <>
          <Stack.Screen name="AboutYou" component={AboutYouScreen} options={{ headerShown: false, headerBackVisible: false }} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false, headerBackVisible: false }} />
        </>
      )}
    </Stack.Navigator>
  );
}
