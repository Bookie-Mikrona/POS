import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useImaTipkovnico } from "@/hooks/useImaTipkovnico";
import { nacrtujPrikazPoljaNadPosTipkovnico } from "@/lib/reveal-above-pos-keyboard";
import SlovenskaKlavijatura from "./SlovenskaKlavijatura";

type PodprtElement = HTMLInputElement | HTMLTextAreaElement;
interface AktivniVnos {
  element: PodprtElement;
  domPot: number[];
  zacetnaVrednost: string;
  zacetniTip: string | null;
  zacetniReadOnly: boolean;
  zacetniInputMode: string | null;
}

const PODPRTI_TIPI = new Set(["text", "search", "email", "tel", "url", "number"]);

function dolociDomPot(element: Element): number[] {
  const pot: number[] = [];
  let trenutni: Element | null = element;
  while (trenutni?.parentElement) {
    pot.unshift(Array.from(trenutni.parentElement.children).indexOf(trenutni));
    trenutni = trenutni.parentElement;
  }
  return pot;
}

function razresiDomPot(pot: number[]): PodprtElement | null {
  let trenutni: Element = document.documentElement;
  for (const indeks of pot) {
    const otrok = trenutni.children.item(indeks);
    if (!otrok) return null;
    trenutni = otrok;
  }
  return trenutni instanceof HTMLInputElement || trenutni instanceof HTMLTextAreaElement
    ? trenutni
    : null;
}

function trenutniElement(vnos: AktivniVnos): PodprtElement {
  return vnos.element.isConnected ? vnos.element : razresiDomPot(vnos.domPot) ?? vnos.element;
}

function obnoviElement(vnos: AktivniVnos): PodprtElement {
  const element = trenutniElement(vnos);
  element.readOnly = vnos.zacetniReadOnly;
  if (vnos.zacetniInputMode === null) element.removeAttribute("inputmode");
  else element.setAttribute("inputmode", vnos.zacetniInputMode);
  if (element instanceof HTMLInputElement && vnos.zacetniTip) {
    delete element.dataset.posOriginalInputType;
    element.type = vnos.zacetniTip;
  }
  return element;
}

function poisciPodprtElement(target: EventTarget | null): PodprtElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest("input, textarea");
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null;
  if (
    element.disabled
    || (element.readOnly && !element.hasAttribute("data-pos-keyboard-readonly-trigger"))
    || element.closest("[data-pos-keyboard-overlay]")
    || element.closest("[data-pos-keyboard-dismiss-disabled]")
    || element.closest('[data-pos-slovenian-keyboard="off"]')
  ) return null;
  if (element instanceof HTMLInputElement && !PODPRTI_TIPI.has(element.type || "text")) return null;
  return element;
}

function naslovElementa(element: PodprtElement): string {
  const labela = element.labels?.[0]?.textContent?.trim();
  return element.getAttribute("aria-label")
    || labela
    || element.placeholder
    || element.name
    || "Vnos";
}

function nastaviVrednost(element: PodprtElement, vrednost: string, dokoncan = false) {
  let novaVrednost = vrednost;
  if (dokoncan && element instanceof HTMLInputElement && element.dataset.posOriginalInputType === "number") {
    novaVrednost = novaVrednost.replace(",", ".");
  }
  if (element.maxLength >= 0) novaVrednost = novaVrednost.slice(0, element.maxLength);

  const prototip = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototip, "value")?.set;
  setter?.call(element, novaVrednost);
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: null,
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function SlovenskaKlavijaturaProvider({ children }: { children: ReactNode }) {
  const imaTipkovnico = useImaTipkovnico();
  const [aktivni, setAktivni] = useState<AktivniVnos | null>(null);
  const navigacijaVTeKu = useRef(false);

  useEffect(() => {
    if (!aktivni) return;
    return nacrtujPrikazPoljaNadPosTipkovnico(trenutniElement(aktivni));
  }, [aktivni]);

  useEffect(() => {
    if (imaTipkovnico) {
      setAktivni(null);
      return;
    }

    const odpri = (naslednji: PodprtElement) => {
      document.documentElement.dataset.posKeyboardActive = "";
      document.dispatchEvent(new Event("pos-keyboard-statechange"));
      const zacetniTip = naslednji instanceof HTMLInputElement ? naslednji.getAttribute("type") : null;
      const zacetniReadOnly = naslednji.readOnly;
      const zacetniInputMode = naslednji.getAttribute("inputmode");
      if (naslednji instanceof HTMLInputElement && naslednji.type === "number") {
        naslednji.dataset.posOriginalInputType = "number";
        naslednji.type = "text";
      }
      naslednji.readOnly = true;
      naslednji.setAttribute("inputmode", "none");
      (navigator as Navigator & { virtualKeyboard?: { hide: () => void } }).virtualKeyboard?.hide();
      const vnos: AktivniVnos = {
        element: naslednji,
        domPot: dolociDomPot(naslednji),
        zacetnaVrednost: naslednji.value,
        zacetniTip,
        zacetniReadOnly,
        zacetniInputMode,
      };
      setAktivni(vnos);
      queueMicrotask(() => {
        const trenutni = trenutniElement(vnos);
        trenutni.readOnly = true;
        trenutni.setAttribute("inputmode", "none");
        (navigator as Navigator & { virtualKeyboard?: { hide: () => void } }).virtualKeyboard?.hide();
      });
    };
    const obDotiku = (event: PointerEvent) => {
      const naslednji = poisciPodprtElement(event.target);
      if (!naslednji) return;
      event.preventDefault();
      odpri(naslednji);
    };
    const obFokusu = (event: FocusEvent) => {
      if (navigacijaVTeKu.current) return;
      const fokusiran = poisciPodprtElement(event.target);
      if (!fokusiran) return;
      odpri(fokusiran);
    };

    document.addEventListener("pointerdown", obDotiku, true);
    document.addEventListener("focusin", obFokusu, true);
    return () => {
      delete document.documentElement.dataset.posKeyboardActive;
      document.dispatchEvent(new Event("pos-keyboard-statechange"));
      document.removeEventListener("pointerdown", obDotiku, true);
      document.removeEventListener("focusin", obFokusu, true);
    };
  }, [imaTipkovnico]);

  const zapri = useCallback((vnos: AktivniVnos | null) => {
    if (vnos) {
      const element = trenutniElement(vnos);
      if (document.activeElement === element) {
        navigacijaVTeKu.current = true;
        const varenFokus = element.closest("[role='dialog']")?.querySelector<HTMLElement>(
          "button:not([disabled]), [tabindex='0']",
        );
        varenFokus?.focus({ preventScroll: true });
        if (document.activeElement === element) element.blur();
        navigacijaVTeKu.current = false;
      }
      obnoviElement(vnos);
    }
    delete document.documentElement.dataset.posKeyboardActive;
    document.dispatchEvent(new Event("pos-keyboard-statechange"));
    setAktivni(null);
  }, []);

  return (
    <>
      {children}
      {aktivni && (
        <SlovenskaKlavijatura
          vrednost={aktivni.zacetnaVrednost}
          naslov={naslovElementa(trenutniElement(aktivni))}
          placeholder={trenutniElement(aktivni).placeholder}
          onSprememba={vrednost => nastaviVrednost(trenutniElement(aktivni), vrednost)}
          onPreklic={() => {
            nastaviVrednost(trenutniElement(aktivni), aktivni.zacetnaVrednost);
            zapri(aktivni);
          }}
          onPotrdi={vrednost => {
            const trenutno = trenutniElement(aktivni);
            nastaviVrednost(trenutno, vrednost, true);

            const obseg = trenutno.closest("[role='dialog'], form") ?? document.body;
            const zacasnoBlokirani = Array.from(obseg.querySelectorAll<PodprtElement>("input, textarea"))
              .filter(element => element !== trenutno && !element.disabled)
              .map(element => ({
                element,
                readOnly: element.readOnly,
                inputMode: element.getAttribute("inputmode"),
                type: element instanceof HTMLInputElement ? element.getAttribute("type") : null,
              }));
            for (const posnetek of zacasnoBlokirani) {
              if (posnetek.element instanceof HTMLInputElement && posnetek.element.type === "number") {
                posnetek.element.type = "text";
              }
              posnetek.element.readOnly = true;
              posnetek.element.setAttribute("inputmode", "none");
            }

            navigacijaVTeKu.current = true;
            trenutno.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              bubbles: true,
              cancelable: true,
            }));
            navigacijaVTeKu.current = false;
            const fokusPoNavigaciji = document.activeElement;
            const fokusSeJePremaknil = fokusPoNavigaciji !== trenutno;
            for (const posnetek of zacasnoBlokirani) {
              posnetek.element.readOnly = posnetek.readOnly;
              if (posnetek.inputMode === null) posnetek.element.removeAttribute("inputmode");
              else posnetek.element.setAttribute("inputmode", posnetek.inputMode);
              if (posnetek.element instanceof HTMLInputElement && posnetek.type) {
                posnetek.element.type = posnetek.type;
              }
            }

            const naslednji = poisciPodprtElement(fokusPoNavigaciji);
            if (naslednji && naslednji !== trenutno) {
              obnoviElement(aktivni);
              const zacetniTip = naslednji instanceof HTMLInputElement
                ? naslednji.getAttribute("type")
                : null;
              const zacetniReadOnly = naslednji.readOnly;
              const zacetniInputMode = naslednji.getAttribute("inputmode");
              if (naslednji instanceof HTMLInputElement && naslednji.type === "number") {
                naslednji.dataset.posOriginalInputType = "number";
                naslednji.type = "text";
              }
              naslednji.readOnly = true;
              naslednji.setAttribute("inputmode", "none");
              setAktivni({
                element: naslednji,
                domPot: dolociDomPot(naslednji),
                zacetnaVrednost: naslednji.value,
                zacetniTip,
                zacetniReadOnly,
                zacetniInputMode,
              });
              return;
            }
            if (fokusSeJePremaknil) obnoviElement(aktivni);
            zapri(aktivni);
          }}
        />
      )}
    </>
  );
}