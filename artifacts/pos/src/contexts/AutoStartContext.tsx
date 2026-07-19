import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Avtostart zaščita — shranjuje stanje na ravni ProtectedRouter (nikoli se ne odmonira).
 *
 * Zakaj Context (ne modul-nivojska spremenljivka)?
 * - Modul-nivojska spremenljivka se PONASTAVI ob Vite HMR posodobitvi tega modula.
 * - useRef v samem Home.tsx se ponastavi ob vsakem remounti komponente (Meni→Mize navigacija).
 * - Context stanje živi v ProtectedRouter, ki preživí vse navigacije v okviru ene seje.
 *
 * Logika:
 * - block()   → avtostart blokira (kliče se ob katerikoli kreaciji naročila)
 * - unblock() → avtostart odblokira (kliče se ob unmountu Order strani, KO ima naročilo artikle)
 * - blocked   → boolenska vrednost za odločitev v Home.tsx effectu
 */

interface AutoStartCtx {
  blocked: boolean;
  block: () => void;
  unblock: () => void;
}

const AutoStartContext = createContext<AutoStartCtx>({
  blocked: false,
  block: () => {},
  unblock: () => {},
});

export function AutoStartProvider({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  const block = useCallback(() => setBlocked(true), []);
  const unblock = useCallback(() => setBlocked(false), []);
  return (
    <AutoStartContext.Provider value={{ blocked, block, unblock }}>
      {children}
    </AutoStartContext.Provider>
  );
}

export function useAutoStart(): AutoStartCtx {
  return useContext(AutoStartContext);
}

/**
 * Ref-nivojski dostop za useLayoutEffect cleanup v Order.tsx:
 * ker se cleanup izvede sinhronsko, ne smemo klicati setState direktno —
 * ampak Context state je React state, zato klic unblock() iz cleanup ok
 * (v React 18 je zunanji klic setState iz non-React kode dovoljen).
 * Preprosto pokličemo unblock() iz useLayoutEffect cleanup — React bo
 * batch-al state update.
 */
export function useAutoStartRef(): React.MutableRefObject<AutoStartCtx> {
  const ctx = useContext(AutoStartContext);
  const ref = useRef(ctx);
  ref.current = ctx; // vedno posodobljeno
  return ref;
}
