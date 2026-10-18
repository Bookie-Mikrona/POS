import { useEffect, useRef, useState } from "react";
import { RefreshCw, UserRound } from "lucide-react";
import { SecretInput } from "@/components/SecretInput";
import { posFetch } from "@/lib/pos-auth-headers";
import {
  notifyPosActorSessionChanged,
  POS_ACTOR_SESSION_CHANGED_EVENT,
  POS_ACTOR_SESSION_REQUIRED_EVENT,
} from "@/lib/pos-actor-session";

const LAST_NATAKAR_ID_KEY = "pos_last_natakar_id";
const LAST_NATAKAR_NAME_KEY = "pos_last_natakar_name";

function getRememberedNatakarName(id: string): string {
  try {
    const raw = localStorage.getItem(LAST_NATAKAR_NAME_KEY);
    const parsed = raw ? JSON.parse(raw) as { id?: string; ime?: string } : null;
    return parsed?.id === id && parsed.ime ? parsed.ime : "";
  } catch {
    return "";
  }
}
function rememberNatakarName(id: string, ime: string) {
  try { localStorage.setItem(LAST_NATAKAR_NAME_KEY, JSON.stringify({ id, ime })); } catch { /* ni pomembno */ }
}
type ActiveShift = { natakariId: number; natakarIme: string; konec: string | null; naOdmoru?: boolean };

function getRememberedNatakarId(): string {
  try {
    return localStorage.getItem(LAST_NATAKAR_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Shared-terminal actor switch.  The Clerk session stays intact. */
export function QuickSwitch() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const rememberedNatakarId = getRememberedNatakarId();
  const [locked, setLocked] = useState(false);
  const [natakarId, setNatakarId] = useState(rememberedNatakarId);
  const [usingRememberedId, setUsingRememberedId] = useState(Boolean(rememberedNatakarId));
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeShifts, setActiveShifts] = useState<ActiveShift[]>([]);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const syncLockState = () => {
      setLocked(!sessionStorage.getItem("pos_actor_session"));
    };
    window.addEventListener(POS_ACTOR_SESSION_CHANGED_EVENT, syncLockState);
    const requireActorSession = () => {
      const selectedId = getRememberedNatakarId();
      if (selectedId) {
        setNatakarId(selectedId);
        setUsingRememberedId(true);
      }
      setLocked(true);
    };
    window.addEventListener(POS_ACTOR_SESSION_REQUIRED_EVENT, requireActorSession);
    return () => {
      window.removeEventListener(POS_ACTOR_SESSION_CHANGED_EVENT, syncLockState);
      window.removeEventListener(POS_ACTOR_SESSION_REQUIRED_EVENT, requireActorSession);
    };
  }, []);
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    setShiftsLoaded(false);
    void Promise.resolve(posFetch(`${base}/api/izmene/aktivne`))
      .then(async response => {
        if (!response?.ok) return [];
        const data = await response.json().catch(() => []);
        return Array.isArray(data) ? data as ActiveShift[] : [];
      })
      .then(shifts => {
        if (cancelled) return;
        const unique = shifts.filter((shift, index, all) =>
          shift.konec == null
          && shift.naOdmoru !== true
          && all.findIndex(candidate => candidate.natakariId === shift.natakariId) === index
        );
        setActiveShifts(unique);
        setShiftsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setActiveShifts([]);
          setShiftsLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [base, locked]);
  if (!locked) {
    const hasActorSession = Boolean(sessionStorage.getItem("pos_actor_session"));
    return <button
      type="button"
      onPointerDown={event => event.preventDefault()}
      onClick={() => {
        setUsingRememberedId(false);
        setLocked(true);
      }}
      className="fixed right-2 top-0 z-40 rounded-b-md bg-muted px-3 py-2 text-xs shadow"
    ><RefreshCw className="mr-1 inline h-4 w-4" />{hasActorSession ? "Zamenjaj natakarja" : "Izberi natakarja"}</button>;
  }
  const selectedName = activeShifts.find(shift => String(shift.natakariId) === natakarId)?.natakarIme
    ?? getRememberedNatakarName(natakarId);
  const switchActor = async () => {
    setError(null);
    try {
      const response = await posFetch(`${base}/api/quick-switch/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ natakarId: Number(natakarId), pin }),
      });
      const data = await response.json().catch(() => ({})) as {
        token?: string;
        error?: string;
        napaka?: string;
        message?: string;
      };
      if (!response.ok || !data.token) {
        setError(data.error ?? data.napaka ?? data.message ?? `Menjava ni uspela (HTTP ${response.status}).`);
        return;
      }
      sessionStorage.setItem("pos_actor_session", data.token);
      try {
        localStorage.setItem(LAST_NATAKAR_ID_KEY, natakarId);
        localStorage.setItem("pos_last_operator_id", natakarId);
        if (selectedName) rememberNatakarName(natakarId, selectedName);
      } catch {
        // Odklep deluje tudi, kadar brskalnik ne dovoli trajnega pomnilnika.
      }
      setPin("");
      setUsingRememberedId(true);
      notifyPosActorSessionChanged();
    } catch {
      setError("Povezava s strežnikom ni uspela. Poskusite znova.");
    }
  };
  const cancelSwitch = () => {
    const confirmedId = localStorage.getItem("pos_last_operator_id");
    if (confirmedId) {
      localStorage.setItem(LAST_NATAKAR_ID_KEY, confirmedId);
      setNatakarId(confirmedId);
      setUsingRememberedId(true);
    } else {
      localStorage.removeItem(LAST_NATAKAR_ID_KEY);
      setNatakarId("");
      setUsingRememberedId(false);
    }
    setLocked(false);
    setError(null);
    setPin("");
  };
  return <div
    data-pos-keyboard-overlay
    data-pos-keyboard-dismiss-disabled
    data-pos-keyboard-autofocus-disabled={!usingRememberedId ? "" : undefined}
    className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4"
  >
    <div className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-6 shadow-xl">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><UserRound /> Hitra menjava natakarja</h2>
      <p className="text-sm text-muted-foreground">
        {usingRememberedId
          ? "Vnesite osebni PIN za nadaljevanje."
          : "Izberite natakarja z aktivno izmeno."}
      </p>
      {!usingRememberedId && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Natakarji z odprto izmeno</p>
          {!shiftsLoaded ? (
            <p className="rounded border bg-muted/40 p-3 text-sm text-muted-foreground">Nalagam aktivne natakarje …</p>
          ) : activeShifts.length === 0 ? (
            <p className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Trenutno ni natakarjev z aktivno izmeno.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
              {activeShifts.map(shift => (
                <button
                  key={shift.natakariId}
                  type="button"
                  onClick={() => {
                    setNatakarId(String(shift.natakariId));
                    rememberNatakarName(String(shift.natakariId), shift.natakarIme);
                    setUsingRememberedId(true);
                    setPin("");
                    setError(null);
                    pinInputRef.current?.focus({ preventScroll: true });
                  }}
                  className="rounded border bg-background px-3 py-2 text-left text-sm"
                >
                  {shift.natakarIme}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {usingRememberedId && (
        <div className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedName ? `Natakar: ${selectedName}` : `Natakar ID: ${natakarId}`}</span>
          <button type="button" onClick={() => setUsingRememberedId(false)} className="text-xs underline underline-offset-2">Izberi drugega natakarja</button>
        </div>
      )}
      {usingRememberedId && <SecretInput
          inputRef={pinInputRef}
          autoFocus={usingRememberedId}
         id="quick-switch-pin"
         ariaLabel="PIN"
         value={pin}
         onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
         onKeyDown={event => event.key === "Enter" && void switchActor()}
          onBlur={event => {
            const nextTarget = event.relatedTarget;
            if (
              nextTarget instanceof HTMLElement
              && nextTarget.closest("[data-pos-keyboard-overlay]") !== null
            ) return;
            event.currentTarget.focus({ preventScroll: true });
          }}
         inputMode="numeric"
         placeholder="PIN"
         className="w-full"
        />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {usingRememberedId && <button type="button" onClick={() => void switchActor()} className="w-full rounded bg-primary p-2 text-primary-foreground">Odkleni in preklopi</button>}
      <button type="button" onClick={cancelSwitch} className="w-full rounded border p-2 text-sm">Prekliči</button>
      <p className="text-center text-xs text-muted-foreground">Prijava velja do zaprtja izmene (največ 16 ur). Če PIN ni nastavljen, naj ga vodja nastavi pri podatkih natakarja.</p>
    </div>
  </div>;
}