/**
 * Payten Android Software APK — pomožne funkcije za obdelavo callbackov
 * in izračun prioritetne verige plačilnih terminalov.
 *
 * Logika je ločena iz Checkout.tsx, da je neodvisno testabilna brez React konteksta.
 */

// ---------------------------------------------------------------------------
// Callback parsing
// ---------------------------------------------------------------------------

/** Rezultat analize callback URL-ja po povratku iz Payten APK */
export type PaytenAndroidCallbackRezultat =
  | { tip: "uspeh"; narociloId: number }
  | { tip: "napaka"; napakaSporocilo: string }
  | { tip: "brez_potrditve" }
  | { tip: "ni_callback" };

/**
 * Razčleni parametre callback URL-ja, ki jih doda Payten APK po plačilu.
 *
 * - `resultCode === "0"` → plačilo uspešno, vrne narociloId
 * - `resultCode !== null && !== "0"` → APK je sporočil napako
 * - `resultCode === null` → fail-safe: APK ni vrnil rezultata, ne izdajamo računa
 * - `paytenAndroid !== "1"` ali manjkajoč storedNarociloId → ni Payten callback
 *
 * @param searchParams    URLSearchParams iz callback URL-ja
 * @param storedNarociloId vrednost iz sessionStorage("paytenAndroid_narociloId")
 */
export function parsePaytenAndroidCallback(
  searchParams: URLSearchParams,
  storedNarociloId: string | null,
): PaytenAndroidCallbackRezultat {
  if (searchParams.get("paytenAndroid") !== "1") {
    return { tip: "ni_callback" };
  }
  if (!storedNarociloId) return { tip: "ni_callback" };
  const narId = parseInt(storedNarociloId);
  if (isNaN(narId)) return { tip: "ni_callback" };

  const resultCode = searchParams.get("resultCode");
  if (resultCode === "0") {
    return { tip: "uspeh", narociloId: narId };
  } else if (resultCode !== null) {
    return {
      tip: "napaka",
      napakaSporocilo: `Payten Android: plačilo neuspešno (koda ${resultCode})`,
    };
  } else {
    return { tip: "brez_potrditve" };
  }
}

// ---------------------------------------------------------------------------
// Terminal priority chain
// ---------------------------------------------------------------------------

/** Tip aktivnega terminala (kateri terminal je na vrsti v prioritetni verigi) */
export type AktivniTerminalTip =
  | "payten_hw"
  | "payten_android"
  | "sumup"
  | "viva_cloud"
  | "viva_android"
  | "viva_ttp"
  | "viva_smart"
  | "brez_terminala";

/**
 * Javna, per-naprava terminalska konfiguracija, relevantna za izbiro terminala.
 *
 * Ta oblika ustreza `naprava.terminalConfig`. Nastavitve podjetja/enote niso
 * vir za izbiro plačilnega terminala.
 */
export interface NastavitveTerminal {
  terminalAktiven?: boolean;
  paytenAndroidAktiven?: boolean;
  sumupAktiven?: boolean;
  vivaTerminalAktiven?: boolean;
  vivaAndroidTerminalAktiven?: boolean;
  vivaTapToPayAktiven?: boolean;
  vivaAktiven?: boolean;
}

/** Override na nivoju naprave; null pomeni "uporabi globalno verigo" */
export type NapravaTerminalOverride =
  | "payten_hw"
  | "payten_android"
  | "sumup"
  | "viva_cloud"
  | "viva_android"
  | "viva_ttp"
  | "viva_smart"
  | "none"
  | null;

/**
 * Vrne kateri terminal je dejansko aktiven glede na prioritetno verigo:
 *   Payten HW → Payten Android SW → SumUp → Viva Cloud → Viva Android → Viva TtP → Viva Smart
 *
 * Ko ima naprava specifičen override (napravaTerminal !== null), le-ta zamenja
 * prioritetno verigo per-naprava:
 *   - Specifični terminal ("payten_hw", "sumup", …) → ta terminal je aktiven
 *   - "none" → naprava je konfigurirana brez terminala; globalna veriga se ignorira
 *   - null → ni overrida; uporabljena je prioritetna veriga zastavic naprave
 *
 * @param terminalConfig Javne terminalske zastavice trenutne naprave
 * @param napravaTerminal Per-napravo override, "none" za brez terminala, ali null za prioritetno verigo
 */
export function izracunajAktivniTerminal(
  terminalConfig: NastavitveTerminal | null,
  napravaTerminal: NapravaTerminalOverride,
): AktivniTerminalTip {
  if (napravaTerminal === "none") {
     // Naprava je izrecno konfigurirana brez terminala — prioritetna veriga se ne upošteva
    return "brez_terminala";
  }
  if (napravaTerminal !== null) {
    // Specifičen override za to napravo
    switch (napravaTerminal) {
      case "payten_hw":      return "payten_hw";
      case "payten_android": return "payten_android";
      case "sumup":          return "sumup";
      case "viva_cloud":     return "viva_cloud";
      case "viva_android":   return "viva_android";
      case "viva_ttp":       return "viva_ttp";
      case "viva_smart":     return "viva_smart";
    }
  }

   // napravaTerminal === null → uporabi prioritetno verigo zastavic trenutne naprave
   if (terminalConfig?.terminalAktiven)            return "payten_hw";
   if (terminalConfig?.paytenAndroidAktiven)       return "payten_android";
   if (terminalConfig?.sumupAktiven)               return "sumup";
   if (terminalConfig?.vivaTerminalAktiven)        return "viva_cloud";
   if (terminalConfig?.vivaAndroidTerminalAktiven) return "viva_android";
   if (terminalConfig?.vivaTapToPayAktiven)        return "viva_ttp";
   if (terminalConfig?.vivaAktiven)                return "viva_smart";
  return "brez_terminala";
}
