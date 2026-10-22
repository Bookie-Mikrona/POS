import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";
import { sifrirajBizboxGeslo, desifrirajBizboxGeslo } from "./kripto-bizbox";

/**
 * Viva Client ID/Secret sta poverilnici podjetja. Shranjeni so šifrirani v
 * system_settings pod ključem viva_credentials:<companyId>, ne na napravi ali enoti.
 */
export type VivaCompanyCredentials = { clientId: string; clientSecret: string; demoNacin: boolean };

const kljuc = (companyId: string) => `viva_credentials:${companyId}`;

export async function preberiVivaPoverilnicePodjetja(companyId: string): Promise<VivaCompanyCredentials | null> {
  const [vrstica] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, kljuc(companyId)));
  if (!vrstica) return null;
  try {
    const p = JSON.parse(desifrirajBizboxGeslo(vrstica.value)) as Partial<VivaCompanyCredentials>;
    if (!String(p.clientId ?? "").trim() || !String(p.clientSecret ?? "").trim()) return null;
    return { clientId: String(p.clientId), clientSecret: String(p.clientSecret), demoNacin: Boolean(p.demoNacin) };
  } catch {
    return null;
  }
}

export async function shraniVivaPoverilnicePodjetja(companyId: string, p: VivaCompanyCredentials): Promise<void> {
  const value = sifrirajBizboxGeslo(JSON.stringify(p));
  await db.insert(systemSettingsTable)
    .values({ key: kljuc(companyId), value })
    .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value } });
}
