import { useCallback, useEffect, useState } from "react";
import { signedProfilePhotoUrl } from "@/services/profileStorage";

export function useSignedPhotoUri(path: string | null | undefined, initialUri: string | null | undefined) {
  const [uri, setUri] = useState<string | null>(initialUri ?? null);
  useEffect(() => { setUri(initialUri ?? null); }, [path, initialUri]);
  const refresh = useCallback(async () => {
    if (!path) return initialUri ?? null;
    const renewed = await signedProfilePhotoUrl(path);
    setUri(renewed);
    return renewed;
  }, [path, initialUri]);
  useEffect(() => {
    if (!path) return;
    const timer = setTimeout(() => { void refresh(); }, 4 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [path, refresh]);
  return { uri: path ? uri : initialUri ?? null, refresh };
}
