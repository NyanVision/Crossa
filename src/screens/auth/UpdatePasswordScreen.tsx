import React, { useState } from 'react';
import { Alert, View, Text } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/AppearanceContext';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { Banner } from '@/components/Banner';
export function UpdatePasswordScreen() {
  const { colors } = useTheme();
  const { updatePassword, signOut, error, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background }}>
    <Text style={{ color: colors.text, fontSize: 22, marginBottom: 16 }}>Choose a new password</Text>
    <Banner message={error} />
    <TextField label="New password" secureTextEntry value={password} onChangeText={setPassword} />
    <TextField label="Confirm password" secureTextEntry value={confirmation} onChangeText={setConfirmation} />
    <Button label="Save password" loading={loading} disabled={password.length < 8 || password !== confirmation} onPress={() => updatePassword(password)} />
    <Button label="Cancel and sign out" onPress={() => { void signOut().catch(() => Alert.alert('Could not sign out', 'Please try again.')); }} />
  </View>;
}
