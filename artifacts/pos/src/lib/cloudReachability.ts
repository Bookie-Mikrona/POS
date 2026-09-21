import { posFetch } from "./pos-auth-headers";

type HealthPayload = { status?: unknown };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function probeCloudApiReachability(fetcher: Fetcher = posFetch): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetcher("/api/healthz", { signal: controller.signal });
    if (!response.ok) return false;
    try {
      const payload = await response.json() as HealthPayload;
      return payload.status === "ok";
    } catch {
      return false;
    }
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}