import { useRef, useState } from "react";

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

export function jePodprtGlasovniVnos(): boolean {
  return getSR() !== null;
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
    const SR = getSR();
    if (!SR) return false;

    if (ref.current) {
      ref.current.stop();
      ref.current = null;
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
