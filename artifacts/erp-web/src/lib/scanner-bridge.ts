// Intentional loopback access: ScannerBridge.exe runs on the user's Windows PC,
// not on the application's API server. Same protocol and port as the POS.
export const SCANNER_BRIDGE_URL = "http://localhost:8765";
export const SCANNER_BRIDGE_DOWNLOAD = "/api/downloads/ScannerBridge.exe";

export type ScannerDevice = { id: string; name: string };
export type ScannerHealth = { status: string; version?: string; scanners: ScannerDevice[] };
export type ScannerImage = { image: string; mimeType: "image/png" | "image/jpeg" };

export async function checkScannerBridge(): Promise<ScannerHealth> {
  const response = await fetch(`${SCANNER_BRIDGE_URL}/health`, {
    signal: AbortSignal.timeout(4000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Most ni dosegljiv (HTTP ${response.status}).`);
  const data = await response.json() as ScannerHealth;
  if (data.status !== "ok" || !Array.isArray(data.scanners)) {
    throw new Error("Most je vrnil neveljaven odgovor.");
  }
  return data;
}

export async function scanDocument(deviceId: string): Promise<ScannerImage> {
  const response = await fetch(`${SCANNER_BRIDGE_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, dpi: 300, color: false, format: "png" }),
    // Do not retry: the scanner may already be running after a network failure.
    signal: AbortSignal.timeout(180000),
  });
  const data = await response.json() as ScannerImage & { detail?: string };
  if (!response.ok) throw new Error(data.detail || `Skeniranje ni uspelo (HTTP ${response.status}).`);
  if (!data.image || !["image/png", "image/jpeg"].includes(data.mimeType)) {
    throw new Error("Most ni vrnil veljavne slike.");
  }
  return data;
}

export function scannerImageFile(image: ScannerImage): File {
  const bytes = Uint8Array.from(atob(image.image), char => char.charCodeAt(0));
  if (!bytes.length) throw new Error("Skenirana slika je prazna.");
  const extension = image.mimeType === "image/png" ? "png" : "jpg";
  return new File([bytes], `sken-${Date.now()}.${extension}`, { type: image.mimeType });
}

export const SCANNER_CONNECTION_HELP =
  "Zaženite ScannerBridge.exe na tem Windows računalniku, priključite HP skener in namestite njegov gonilnik WIA. Če brskalnik vpraša za dostop do lokalne naprave, ga dovolite.";
