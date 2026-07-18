import { setBaseUrl } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
setBaseUrl(`${BASE}/api`);

export function getActiveCompanyId(): string | null {
  try {
    const stored = localStorage.getItem("erp_active_company");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.id ?? null;
  } catch { return null; }
}