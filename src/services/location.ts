import * as Location from "expo-location";

export type LocationPermissionResult = "granted" | "denied" | "unavailable";

// Requests foreground location permission only. Crossa never requests
// "Always" / background location, and the raw coordinates returned here
// are used only to compute a rounded, approximate distance client-side —
// they are never sent to other users or shown on a map.
export async function requestLocationPermission(): Promise<LocationPermissionResult> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status === "granted") return "granted";
  return "denied";
}

export async function getApproximateDistanceRange(
  targetLat: number,
  targetLng: number
): Promise<string | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") return null;

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced, // city-block accuracy is enough
  });

  const km = haversineKm(
    position.coords.latitude,
    position.coords.longitude,
    targetLat,
    targetLng
  );

  // Round so nothing close to an exact position is ever surfaced.
  if (km < 1) return "Within 1 km";
  if (km < 3) return "1–3 km";
  if (km < 5) return "3–5 km";
  return "5+ km";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
