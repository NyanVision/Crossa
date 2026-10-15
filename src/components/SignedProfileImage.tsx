import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";
import { useSignedPhotoUri } from "@/hooks/useSignedPhotoUri";

export function SignedProfileImage({
  path,
  uri,
  style,
  accessibilityLabel,
}: {
  path?: string | null;
  uri?: string | null;
  style: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}) {
  const { uri: currentUri, refresh } = useSignedPhotoUri(path, uri);
  if (!currentUri) return null;
  return <Image source={{ uri: currentUri }} style={style} accessibilityLabel={accessibilityLabel} onError={() => { void refresh(); }} />;
}
