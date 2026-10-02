import type { AjpesAnnualProfile, AjpesAnnualReport, AjpesAnnualSettings } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DECISIONS, FRAMEWORKS, LEGAL_FORMS, PROFILE_SIZES, changeProfile, confirmProfile, defaultProfile, profileIncomplete, validCriterion } from "./ajpes-annual-profile-model";

type Patch = (fn: (s: AjpesAnnualSettings) => AjpesAnnualSettings) => void;
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const PURPOSE: Record<string, string> = { statistics: "Statistika", publication: "Objava", periodic: "Obdobno poročanje" };
const STATUS: Record<string, string> = { required: "Obvezno", conditional: "Pogojno", not_required: "Ni obvezno" };

function navKey(e: React.KeyboardEvent<HTMLElement>) {
  const t = e.target as HTMLElement;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "BUTTON") return;
  const isSelect = tag === "SELECT";
  if (!(e.key === "Enter" || (!isSelect && (e.key === "ArrowDown" || e.key === "ArrowUp")))) return;
  const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-nav]:not([disabled])"));
  const i = els.indexOf(t);
  const next = els[e.key === "ArrowUp" ? i - 1 : i + 1];
  e.preventDefault();
  if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select(); }
}

export function ProfileEditor({ report, draft, viewer, dirty, patch }: {
  report: AjpesAnnualReport; draft: AjpesAnnualSettings; viewer: boolean; dirty: boolean; patch: Patch;
}) {
  const p: AjpesAnnualProfile = draft.profile ?? defaultProfile();
  const set = (c: Partial<AjpesAnnualProfile>) => patch((s) => changeProfile(s, c));
  const missing = profileIncomplete(p, report.year);
  const a = report.profileAssessment;
  const serverOk = !dirty && p.confirmed && (a ? a.confirmed && a.supported : true);
  const crit = (g: "currentCriteria" | "previousCriteria", title: string) => (
    <fieldset className="grid gap-2 sm:grid-cols-3 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium">{title}</legend>
      {([["assets", "Aktiva (EUR)"], ["revenue", "Prihodki (EUR)"], ["employees", "Zaposleni (povpr.)"]] as const).map(([k, l]) => {
        const v = p[g][k];
        const bad = v.trim() !== "" && !validCriterion(v);
        return (
          <div key={k}>
            <label htmlFor={`pf-${g}-${k}`} className="text-xs text-muted-foreground block mb-1">{l}</label>
            <Input id={`pf-${g}-${k}`} data-nav data-testid={`profile-${g}-${k}`} inputMode="decimal" disabled={viewer} aria-invalid={bad}
              placeholder="ni vneseno" value={v} onChange={(e) => set({ [g]: { ...p[g], [k]: e.target.value } })} />
            {bad && <span className="text-[10px] text-destructive">Neveljavno število</span>}
          </div>
        );
      })}
    </fieldset>
  );
  const select = (id: string, label: string, value: string, opts: [string, string][], key: keyof AjpesAnnualProfile, unk = "Ni določeno") => (
    <div>
      <label htmlFor={`pf-${id}`} className="text-xs text-muted-foreground block mb-1">{label}</label>
      <select id={`pf-${id}`} data-nav data-testid={`profile-${id}`} disabled={viewer} className={sel} value={value}
        onChange={(e) => set({ [key]: e.target.value } as Partial<AjpesAnnualProfile>)}>
        <option value="unknown">{unk}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  return (
    <div className="space-y-5" onKeyDown={navKey}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Pravni in poročevalski profil za leto {report.year}</h3>
          <Badge data-testid="profile-state" variant={serverOk ? "default" : "secondary"}>
            {dirty ? "Neshranjeno" : serverOk ? "Potrjen profil (strežnik)" : p.confirmed ? "Potrditev ni veljavna po strežniku" : "Nepotrjen profil"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Profil je pravna ugotovitev računovodje. Sistem je ne izpeljuje iz stare oznake velikosti; vsaka sprememba razveljavi potrditev.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {select("legalForm", "Pravnoorganizacijska oblika", p.legalForm, LEGAL_FORMS, "legalForm")}
          {select("framework", "Računovodski okvir", p.framework, FRAMEWORKS, "framework")}
          {select("size", "Velikost družbe", p.size, PROFILE_SIZES, "size")}
          <div>
            <label htmlFor="pf-start" className="text-xs text-muted-foreground block mb-1">Začetek obdobja</label>
            <Input id="pf-start" data-nav data-testid="profile-periodStart" type="date" disabled={viewer} value={p.periodStart} onChange={(e) => set({ periodStart: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pf-end" className="text-xs text-muted-foreground block mb-1">Konec obdobja</label>
            <Input id="pf-end" data-nav data-testid="profile-periodEnd" type="date" disabled={viewer} value={p.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} />
          </div>
        </div>
        {crit("currentCriteria", `Merila velikosti ${report.year}`)}
        {crit("previousCriteria", `Merila velikosti ${report.year - 1}`)}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-basis" className="text-xs text-muted-foreground block mb-1">Podlaga za velikost</label>
            <textarea id="pf-basis" data-nav data-testid="profile-sizeBasis" disabled={viewer} rows={2} className="w-full rounded-md border bg-background p-2 text-sm" value={p.sizeBasis} onChange={(e) => set({ sizeBasis: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pf-exc" className="text-xs text-muted-foreground block mb-1">Izjema prejšnjega leta</label>
            <textarea id="pf-exc" data-nav data-testid="profile-previousYearException" disabled={viewer} rows={2} className="w-full rounded-md border bg-background p-2 text-sm" value={p.previousYearException} onChange={(e) => set({ previousYearException: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Odločitve</h3>
        <p className="text-xs text-muted-foreground">Poseben režim zajema subjekte javnega interesa, finančne in naložbene subjekte s posebnimi pravili; pregledajte dejanske obveznosti.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DECISIONS.map(([k, l]) => (
            <div key={k}>
              <label htmlFor={`pf-${k}`} className="text-xs text-muted-foreground block mb-1">{l}</label>
              <select id={`pf-${k}`} data-nav data-testid={`profile-${k}`} disabled={viewer} className={sel} value={p[k]}
                onChange={(e) => set({ [k]: e.target.value } as Partial<AjpesAnnualProfile>)}>
                <option value="unknown">Ni ocenjeno</option><option value="yes">Da</option><option value="no">Ne</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <label htmlFor="pf-cb" className="text-xs text-muted-foreground block">Podlaga potrditve profila</label>
        <textarea id="pf-cb" data-nav data-testid="profile-confirmationBasis" disabled={viewer} rows={2} className="w-full rounded-md border bg-background p-2 text-sm" value={p.confirmationBasis} onChange={(e) => set({ confirmationBasis: e.target.value })} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" data-testid="profile-confirm" disabled={viewer || p.confirmed || missing.length > 0}
            onClick={() => patch((s) => confirmProfile(s))}>Potrdi profil po preverjanju</Button>
          {missing.length > 0 && <span className="text-xs text-muted-foreground">Manjka: {missing.join(", ")}.</span>}
          {p.confirmed && <span className="text-xs text-muted-foreground">Potrditev dokončno preveri strežnik po shranitvi.</span>}
        </div>
      </section>

      <section className="space-y-2 rounded-md border p-3" aria-label="Ocena obveznosti">
        <h3 className="text-sm font-semibold">Ocena obveznosti</h3>
        {!a ? <p className="text-sm text-muted-foreground">Ocena ni na voljo za to poročilo.</p> : (
          <>
            {dirty && <p role="status" data-testid="assessment-stale" className="text-sm text-amber-700 dark:text-amber-400">Neshranjene spremembe profila: spodnja ocena velja za zadnji shranjeni profil in je zastarela.</p>}
            <p className="text-xs text-muted-foreground">Pravila {a.rulesVersion}, katalog {a.catalogYear}. {a.supported ? "" : "Profil ni podprt. "}{a.confirmed ? "Shranjeni profil je potrjen." : "Shranjeni profil ni potrjen."}</p>
            {a.issues.map((i, k) => <div key={`${i.code}-${k}`} className={`text-sm ${i.blocking ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>{i.blocking && <Badge variant="destructive" className="mr-2">Blokira</Badge>}{i.message}</div>)}
            <ul className={`divide-y ${dirty ? "opacity-60" : ""}`}>
              {a.obligations.map((o) => (
                <li key={o.code} data-testid={`obligation-${o.code}`} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.label}</span>
                    <Badge variant="outline">{PURPOSE[o.purpose] ?? o.purpose}</Badge>
                    <Badge variant={o.status === "required" ? "default" : "secondary"}>{STATUS[o.status] ?? o.status}</Badge>
                    <span className="text-xs text-muted-foreground">{o.available ? "Številčni izpis v katalogu je na voljo" : "Priprava v poznejši fazi"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{o.explanation}</p>
                </li>
              ))}
            </ul>
            {a.sources.length > 0 && <p className="text-[11px] text-muted-foreground">Viri: {a.sources.join("; ")}</p>}
          </>
        )}
        <p className="text-xs text-muted-foreground">Izvoz PDF/XLSX vsebuje samo številčne izkaze in ni popolno javno letno poročilo. Izvoz ni oddaja pri AJPES.</p>
      </section>
    </div>
  );
}
