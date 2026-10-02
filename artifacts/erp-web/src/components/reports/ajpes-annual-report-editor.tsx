import { useRef } from "react";
import type { AjpesAnnualReport, AjpesAnnualSettings } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { fmtAmount, normalizeAmount, META, SIZES, METHODS, PREVIOUS_MODES } from "./ajpes-annual-report-model";

type Patch = (fn: (s: AjpesAnnualSettings) => AjpesAnnualSettings) => void;

export function ManualGrid({ report, draft, viewer, year, patch }: {
  report: AjpesAnnualReport; draft: AjpesAnnualSettings; viewer: boolean; year: number;
  patch: Patch;
}) {
  const refs = useRef(new Map<string, HTMLInputElement>());
  const leaves = report.aopRows.filter((r) => r.editable).map((r) => r.code);
  const nav = (code: string, col: 0 | 1, key: string, e: React.KeyboardEvent) => {
    const i = leaves.indexOf(code);
    let t: string | null = null;
    if (key === "ArrowDown") t = `${leaves[i + 1]}:${col}`;
    else if (key === "ArrowUp") t = `${leaves[i - 1]}:${col}`;
    else if (key === "Enter" || key === "ArrowRight") t = col === 0 ? `${code}:1` : `${leaves[i + 1]}:0`;
    else if (key === "ArrowLeft" && col === 1 && (e.target as HTMLInputElement).selectionStart === 0) t = `${code}:0`;
    const el = t ? refs.current.get(t) : undefined;
    if (el) { e.preventDefault(); el.focus(); el.select(); } else if (key === "Enter") e.preventDefault();
  };
  const set = (k: "currentValues" | "previousValues", code: string, v: string) =>
    patch((s) => { const m = { ...s[k] }; if (v === "") delete m[code]; else m[code] = v; return { ...s, [k]: m }; });
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs"><tr><th className="p-2 text-left">AOP</th><th className="p-2 text-left">Postavka</th><th className="p-2 text-right">{year}</th><th className="p-2 text-right">{year - 1}</th></tr></thead>
        <tbody>
          {report.aopRows.map((r) => (
            <tr key={r.code} className={`border-t ${r.editable ? "" : "bg-muted/30 font-medium"}`}>
              <td className="p-2 font-mono text-xs">{r.code}</td>
              <td className="p-2">{r.label}{r.formula && <span className="block text-xs text-muted-foreground font-normal">{r.formula}</span>}</td>
              {r.editable ? ([["currentValues", r.current], ["previousValues", r.previous]] as const).map(([k, shown], c) => {
                const raw = draft[k][r.code];
                const bad = raw !== undefined && raw.trim() !== "" && normalizeAmount(raw) === null;
                return (
                  <td key={k} className="p-1 w-40">
                    <Input
                      ref={(el) => { if (el) refs.current.set(`${r.code}:${c}`, el); else refs.current.delete(`${r.code}:${c}`); }}
                      aria-label={`${r.code} ${c === 0 ? year : year - 1}`} aria-invalid={bad} disabled={viewer} inputMode="decimal"
                      className="h-8 text-right tabular-nums" placeholder={shown ? fmtAmount(shown) : "—"} value={raw ?? ""}
                      onChange={(e) => set(k, r.code, e.target.value)} onKeyDown={(e) => nav(r.code, c as 0 | 1, e.key, e)} />
                    {bad && <span className="text-[10px] text-destructive">Neveljavno število</span>}
                  </td>
                );
              }) : (
                <>
                  <td className="p-2 text-right tabular-nums">{fmtAmount(r.current)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtAmount(r.previous)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export function PrepEditor({ report, draft, viewer, year, patch }: {
  report: AjpesAnnualReport; draft: AjpesAnnualSettings; viewer: boolean; year: number; patch: Patch;
}) {
  const editableRows = report.aopRows.filter((r) => r.editable && r.ledgerMappable !== false);
  return (
    <>
          <section className="grid gap-3 sm:grid-cols-2">
            {META.map(([k, label]) => (
              <div key={k}>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor={`m-${k}`}>{label}</label>
                <Input id={`m-${k}`} disabled={viewer} value={draft.metadata[k] ?? ""} onChange={(e) => patch((s) => ({ ...s, metadata: { ...s.metadata, [k]: e.target.value } }))} />
              </div>
            ))}
            <div className="sm:col-span-2 text-xs text-muted-foreground" data-testid="legacy-readonly">
              Velikost: {SIZES.find(([v]) => v === draft.metadata.size)?.[1] ?? "ni določena"} · Standard: {METHODS.find(([v]) => v === draft.metadata.accountingMethod)?.[1] ?? "ni določen"}. Vrednosti se urejajo v zavihku Profil.
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1" htmlFor="m-prev">Podatki prejšnjega leta</label>
              <select id="m-prev" disabled={viewer} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.metadata.previousDataMode ?? "ledger"} onChange={(e) => patch((s) => ({ ...s, metadata: { ...s.metadata, previousDataMode: e.target.value } }))}>
                {PREVIOUS_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">Preslikava kontov na AOP</h3>
            <p className="text-xs text-muted-foreground mb-2">Vsako preslikavo je treba pregledati. Možnost "Ignoriraj" zahteva razlog.</p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs"><tr><th className="p-2 text-left">Konto</th><th className="p-2 text-right">Saldo {year}</th><th className="p-2 text-right">Saldo {year - 1}</th><th className="p-2 text-left">AOP</th><th className="p-2 text-left">Razlog</th></tr></thead>
                <tbody>
                  {report.accounts.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Ni kontov s prometom v obdobju.</td></tr>}
                  {report.accounts.map((a) => {
                    const v = draft.mappings[a.accountId] ?? "";
                    const needReason = v === "ignore";
                    return (
                      <tr key={a.accountId} className="border-t">
                        <td className="p-2"><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</td>
                        <td className="p-2 text-right tabular-nums">{fmtAmount(a.currentBalance)}</td>
                        <td className="p-2 text-right tabular-nums">{fmtAmount(a.previousBalance)}</td>
                        <td className="p-2">
                          <select aria-label={`AOP za ${a.code}`} disabled={viewer} className="h-8 max-w-[16rem] rounded-md border bg-background px-1 text-xs" value={v}
                            onChange={(e) => patch((s) => { const m = { ...s.mappings }; if (e.target.value) m[a.accountId] = e.target.value; else delete m[a.accountId]; return { ...s, mappings: m }; })}>
                            <option value="">Nepreslikano</option>
                            <option value="ignore">Ignoriraj (z razlogom)</option>
                            {editableRows.map((r) => <option key={r.code} value={r.code}>{r.code} {r.label}</option>)}
                          </select>
                        </td>
                        <td className="p-2">
                          {needReason && <Input aria-label="Razlog" disabled={viewer} className="h-8 text-xs" aria-invalid={!(draft.mappingReasons[a.accountId] ?? "").trim()} value={draft.mappingReasons[a.accountId] ?? ""} onChange={(e) => patch((s) => ({ ...s, mappingReasons: { ...s.mappingReasons, [a.accountId]: e.target.value } }))} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">Zaključne knjižbe, izločene iz izkaza poslovnega izida</h3>
            <p className="text-xs text-muted-foreground mb-2">Izberite točno določene knjižbe. Datumov se ne ugiba.</p>
            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {report.journals.length === 0 && <p className="p-3 text-sm text-muted-foreground">Ni knjižb za izbiro.</p>}
              {report.journals.map((j) => (
                <label key={j.id} className="flex items-start gap-2 p-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-1" disabled={viewer} checked={draft.excludedEntryIds.includes(j.id)}
                    onChange={(e) => patch((s) => ({ ...s, excludedEntryIds: e.target.checked ? [...s.excludedEntryIds, j.id] : s.excludedEntryIds.filter((x) => x !== j.id) }))} />
                  <span><span className="font-mono text-xs">{j.number}</span> · {j.date} · {j.reference} — {j.description}</span>
                </label>
              ))}
            </div>
          </section>
        </>
  );
}
