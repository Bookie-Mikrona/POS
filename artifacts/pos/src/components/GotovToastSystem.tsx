import { useEffect, useState } from "react";
import { CheckCircle2, X, ChefHat, GlassWater } from "lucide-react";
import { useGotovToast, type GotovToastItem } from "@/contexts/GotovToastContext";

function mizaLabel(t: GotovToastItem) {
  return t.mizaIme ?? (t.mizaStevilka != null ? `Miza ${t.mizaStevilka}` : "?");
}

function ActiveToast({ t, onDismiss, onMinimize }: {
  t: GotovToastItem;
  onDismiss: () => void;
  onMinimize: () => void;
}) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const total = 8000;
    const iv = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / total) * 100);
      setProgress(pct);
      if (pct === 0) clearInterval(iv);
    }, 100);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="bg-emerald-600 rounded-xl shadow-xl overflow-hidden w-80 pointer-events-auto">
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-100 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-emerald-200 uppercase tracking-wide leading-tight mb-0.5">Artikel pripravljen</p>
          <p className="text-xs text-emerald-100 leading-tight">{mizaLabel(t)}</p>
          <p className="text-sm font-bold text-white leading-snug mt-0.5 break-words">
            {t.ime}{t.kolicina > 1 && <span className="text-emerald-200 font-normal"> ×{t.kolicina}</span>}
          </p>
          {t.opomba && (
            <p className="text-xs text-yellow-200 italic mt-0.5 break-words">↳ {t.opomba}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onMinimize}
            className="text-emerald-200 hover:text-white p-1 rounded"
            title="Minimiziraj"
          >
            <span className="text-xs font-bold">—</span>
          </button>
          <button
            onClick={onDismiss}
            className="text-emerald-200 hover:text-white p-1 rounded"
            title="Zapri"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="h-1 bg-emerald-700">
        <div
          className="h-full bg-white/40 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function GotovToastSystem() {
  const { toasts, dismissToast, minimizeToast, reopenToast } = useGotovToast();

  const active = toasts.filter(t => t.phase === "active");
  const minimized = toasts.filter(t => t.phase === "minimized");

  return (
    <>
      {/* Minimizirane ikone — zgornji levi kot */}
      {minimized.length > 0 && (
        <div className="fixed top-4 left-4 z-50 flex flex-col gap-1.5 pointer-events-auto">
          {minimized.map(t => (
            <button
              key={t.id}
              onClick={() => reopenToast(t.id)}
              className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-full shadow-md hover:bg-emerald-600 transition-colors max-w-[160px]"
              title={`${mizaLabel(t)}: ${t.ime}`}
            >
              {t.vir === "tocilnica" ? <GlassWater className="h-3.5 w-3.5 shrink-0" /> : <ChefHat className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{mizaLabel(t)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Aktivni toasti — zgornji desni kot */}
      {active.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {active.map(t => (
            <ActiveToast
              key={t.id}
              t={t}
              onDismiss={() => dismissToast(t.id)}
              onMinimize={() => minimizeToast(t.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}
