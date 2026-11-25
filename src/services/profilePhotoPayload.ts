/** Convert a React Native FileReader result to a raw Storage upload body. */
export function profilePhotoPayload(dataUrl: string, uri: string) {
  const match = /^data:([^;,]*);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error("The selected photo could not be read.");
  const supported = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  } as const;
  const mime = match[1].toLowerCase();
  const suffix = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  const inferred = suffix === "png" ? "image/png" : suffix === "webp" ? "image/webp"
    : suffix === "jpg" || suffix === "jpeg" ? "image/jpeg" : null;
  const contentType = mime in supported ? mime as keyof typeof supported : inferred;
  if (!contentType) throw new Error("Choose a JPEG, PNG, or WebP photo.");
  const binary = atob(match[2]);
  if (!binary.length) throw new Error("The selected photo is empty.");
  const body = Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
  return { body, contentType, extension: supported[contentType] };
}
