import { useRef, useState } from "react";
import { jePodprtoSnemanje, posnemiStavek } from "@/lib/glasovni-posnetek";

/** Enotno mesto za nastavitev jezika prepoznavanja govora v celotni aplikaciji. */
export const GOVOR_JEZIK = "sl-SI";

/** Minimalna zaupljivost prepoznanega govora (0–1). Rezultati pod pragom so zavrnjeni.
 *  Privzeto 0 = sprejmi vse, kar brskalnik prepozna (Chrome vrača nizke vrednosti za sl-SI). */
export const GLASOVNI_PRAG_ZAUPANJA = 0;

type SpeechAlternative = { transcript: string; confidence: number };
type SpeechResult = { [i: number]: SpeechAlternative; length: number; isFinal: boolean };
type SpeechResultList = { [i: number]: SpeechResult; length: number };

type SRC = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: SpeechResultList; resultIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSR(): SRC | null {
  const w = window as unknown as { SpeechRecognition?: SRC; webkitSpeechRecognition?: SRC };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type NativniGovor = { available: () => boolean; start: () => void; stop: () => void };
function getNativniGovor(): NativniGovor | null {
  const n = (window as unknown as { BookieSpeech?: NativniGovor }).BookieSpeech;
  try { return n && n.available() ? n : null; } catch { return null; }
}

export function jePodprtGlasovniVnos(): boolean {
  return getNativniGovor() !== null || getSR() !== null || jePodprtoSnemanje();
}

export type GlasovniCallbacks = {
  onResult: (tekst: string) => void;
  onError?: (napaka?: string) => void;
  onEnd?: () => void;
  /** Sproži se za vsak vmesni ali dokončni rezultat — signal da brskalnik sliši govor. */
  onActivity?: () => void;
};

export type GlasovniMoznosti = {
  /** Privzeto false. True = Chrome posluša neprekinjeno; sejo je treba ročno ustaviti z ustavi(). */
  continuous?: boolean;
};

/**
 * Hook za glasovni vnos. Jezik je vedno sl-SI.
 * - `poslusam` — true med snemanjem
 * - `zacni(callbacks, pragZaupanja?, moznosti?)` — začne poslušanje; vrne false če brskalnik ne podpira API-ja
 * - `ustavi()` — ročno ustavi snemanje
 *
 * Načini:
 * - continuous=false (privzeto): Chrome samodejno zaključi sejo po prvem stavku in dostavi isFinal=true.
 * - continuous=true: Chrome posluša neprekinjeno, dostavi isFinal=true za vsak zaključen stavek,
 *   sejo je treba ustaviti ročno (ustavi()) ali prek tihega timerja.
 */
export function useGlasovniUkaz() {
  const [poslusam, setPoslusam] = useState(false);
  const ref = useRef<{ stop: () => void } | null>(null);

  const ustavi = () => {
    ref.current?.stop();
    ref.current = null;
    setPoslusam(false);
  };

  const zacni = (callbacks: GlasovniCallbacks, pragZaupanja?: number, moznosti?: GlasovniMoznosti): boolean => {
    const nativni = getNativniGovor();
    const SR = getSR();
    if (!nativni && !SR && !jePodprtoSnemanje()) return false;

    if (ref.current) {
      ref.current.stop();
      ref.current = null;
    }

    if (nativni) {
      // Aplikacija Bookie (ZCS): Androidovo prepoznavanje govora, enako hitro kot v Chromu.
      const neprekinjeno = moznosti?.continuous ?? false;
      let ustavljeno = false;
      const poslusalec = (e: Event) => {
        const d = (e as CustomEvent<{ type: string; text?: string }>).detail;
        if (d.type === "activity") callbacks.onActivity?.();
        else if (d.type === "result" && d.text) callbacks.onResult(d.text);
        else if (d.type === "error") { ustavljeno = true; callbacks.onError?.(d.text); }
        else if (d.type === "end") {
          if (neprekinjeno && !ustavljeno) { nativni.start(); return; }
          window.removeEventListener("bookie-speech", poslusalec);
          ref.current = null;
          setPoslusam(false);
          callbacks.onEnd?.();
        }
      };
      window.addEventListener("bookie-speech", poslusalec);
      ref.current = { stop: () => { ustavljeno = true; nativni.stop(); } };
      setPoslusam(true);
      nativni.start();
      return true;
    }

    if (!SR) {
      // Android WebView: snemanje stavka + prepis na strežniku. continuous = nov stavek po vsakem prepisu.
      const neprekinjeno = moznosti?.continuous ?? false;
      let ustavljeno = false;
      let trenutni: { stop: () => void } | null = null;
      const konec = () => {
        ref.current = null;
        setPoslusam(false);
        callbacks.onEnd?.();
      };
      const naslednji = () => {
        trenutni = posnemiStavek({
          onResult: callbacks.onResult,
          onActivity: () => callbacks.onActivity?.(),
          onError: (napaka) => { ustavljeno = true; callbacks.onError?.(napaka); },
          onEnd: () => (neprekinjeno && !ustavljeno ? naslednji() : konec()),
        });
      };
      ref.current = { stop: () => { ustavljeno = true; trenutni?.stop(); } };
      setPoslusam(true);
      naslednji();
      return true;
    }

    const r = new SR();
    r.lang = GOVOR_JEZIK;
    r.continuous = moznosti?.continuous ?? false;
    // interimResults=false: Chrome dostavi vsak rezultat ENKRAT ob koncu fraze (isFinal=true).
    // Z interimResults=true Chrome na nekaterih napravah (npr. Android) večkrat dostavi
    // isti vsebino kot isFinal, kar povzroči podvojene besede v transkriptu.
    r.interimResults = false;
    r.maxAlternatives = 1;
    // Zaščita pred kaskado: sledimo ali je seja že sprožila onend.
    // Klic stop() na že-končani seji bi sprožil dodaten onend → neskončna zanka restartov.
    let sejaPokoncana = false;
    ref.current = {
      stop: () => {
        if (!sejaPokoncana) r.stop();
      },
    };
    setPoslusam(true);

    let processedUpTo = -1;
    r.onresult = (e) => {
      callbacks.onActivity?.();
      const threshold = pragZaupanja ?? GLASOVNI_PRAG_ZAUPANJA;
      const noviFinal: string[] = [];
      const from = Math.max(e.resultIndex, processedUpTo + 1);
      for (let i = from; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        processedUpTo = i;
        const alt = e.results[i][0];
        const conf = alt.confidence;
        if (typeof conf !== "number" || isNaN(conf) || conf >= threshold) {
          noviFinal.push(alt.transcript);
        }
      }
      const tekst = noviFinal.join(" ").trim();
      if (tekst) {
        callbacks.onResult(tekst);
      }
    };
    r.onerror = (e) => {
      setPoslusam(false);
      callbacks.onError?.(e.error);
    };
    r.onend = () => {
      sejaPokoncana = true;
      setPoslusam(false);
      callbacks.onEnd?.();
    };
    r.start();
    return true;
  };

  return { poslusam, zacni, ustavi };
}
