import type { AjpesAnnualReport, AjpesAnnualSettings } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { changeNarrative, emptyNarrative } from "./ajpes-annual-report-model";
import { navKey } from "./ajpes-annual-profile-editor";

type Patch = (fn: (s: AjpesAnnualSettings) => AjpesAnnualSettings) => void;
const area = "w-full rounded-md border bg-background p-2 text-sm leading-relaxed";
const DOC_STATUS: Record<string, string> = { present: "Pripravljeno", missing: "Manjka", not_required: "Ni obvezno" };

const NOTES: [string, string, string, number][] = [
  ["accountingPolicies", "Računovodske usmeritve", "Opišite uporabljene računovodske usmeritve, metode vrednotenja, prevrednotenje in pošteno vrednost, če se uporabljajo.", 50000],
  ["explanations", "Pojasnila k izkazom", "Po členu 69 ZGD-1 in SRS: pogojne obveznosti, zavarovani dolgovi, posojila vodstvu, izredni prihodki in odhodki, terjatve in obveznosti z ročnostjo nad 5 let, povprečno število zaposlenih, lastni deleži, druga razkritja SRS. Vrednosti vnesite sami; sistem jih ne izpelje iz AOP.", 50000],
];
const MICRO: [string, string, string][] = [
  ["disclosure4", "Razkritje 4: pogojne finančne obveznosti zunaj bilance stanja", "Posebej navedite pokojninske obveznosti in obveznosti do družb v skupini. Če jih ni, to izrecno zapišite, npr. 'Ni takih obveznosti'."],
  ["disclosure5", "Razkritje 5: z jamstvom zavarovani dolgovi", "Po postavkah bilance stanja in z vrsto zavarovanja. Če jih ni, izrecno zapišite."],
  ["disclosure6", "Razkritje 6: predujmi in posojila vodstvu, nadzornemu svetu in zaposlenim", "Po kategorijah; ločeno obresti, pogoji, vrnjeni in odpisani zneski ter dana jamstva."],
  ["disclosure10", "Razkritje 10: lastni deleži", "Posli, zastave, število, vrednost, delež kapitala, datum, razlog, protivrednost in stanje ob zaključku bilance."],
];

function Field({ id, label, hint, value, max, rows = 6, viewer, onChange }: { id: string; label: string; hint?: string; value: string; max: number; rows?: number; viewer: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={`nar-${id}`} className="text-sm font-medium block">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-1">{hint}</p>}
      <textarea id={`nar-${id}`} data-nav data-testid={`nar-${id}`} rows={rows} maxLength={max} disabled={viewer} className={area}
        placeholder="Vnesite besedilo. Prazno polje se ne šteje kot izjava." value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="text-[10px] text-muted-foreground text-right">{value.length} / {max}</div>
    </div>
  );
}
function Line({ id, label, value, type = "text", viewer, onChange }: { id: string; label: string; value: string; type?: string; viewer: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={`nar-${id}`} className="text-xs text-muted-foreground block mb-1">{label}</label>
      <input id={`nar-${id}`} data-nav data-testid={`nar-${id}`} type={type} maxLength={type === "date" ? 10 : 250} disabled={viewer}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function NarrativeEditor({ report, draft, viewer, dirty, patch }: { report: AjpesAnnualReport; draft: AjpesAnnualSettings; viewer: boolean; dirty: boolean; patch: Patch }) {
  const n = { ...emptyNarrative(), ...(draft.narrative ?? {}) };
  const pr = draft.profile;
  const micro = pr?.microRegime === "yes";
  const simplified = pr?.simplifiedSubmission === "yes";
  const pa = report.publicationAssessment;
  const setText = (k: string, v: string) => patch((s) => changeNarrative(s, { text: { [k]: v } }));
  return (
    <div className="space-y-5" onKeyDown={navKey}>
      <section className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Besedila letnega poročila</h3>
          <Badge data-testid="narrative-mode" variant="outline">{micro ? "Posebni mikro režim: razkritja 4, 5, 6, 10" : pr?.microRegime === "no" ? "Pojasnila in računovodske usmeritve" : "Režim ni določen"}</Badge>
          {dirty && <Badge variant="secondary">Neshranjeno</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">Besedila so izjava računovodje; sistem jih ne izpolni iz podatkov. Delne osnutke lahko shranite. Polja drugega načina ostanejo shranjena, vendar se ne uporabijo.</p>
        {pr?.microRegime !== "no" && !micro && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">V profilu določite, ali velja posebni mikro režim (70.a člen).</p>}
      </section>

      {!micro && NOTES.map(([k, l, h, m]) => (
        <Field key={k} id={k} label={l} hint={h} max={m} rows={k === "explanations" ? 10 : 7} viewer={viewer} value={n[k as "accountingPolicies"]} onChange={(v) => setText(k, v)} />
      ))}
      {micro && (
        <>
          {MICRO.map(([k, l, h]) => <Field key={k} id={k} label={l} hint={h} max={12000} viewer={viewer} value={n[k as "disclosure4"]} onChange={(v) => setText(k, v)} />)}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" data-nav data-testid="nar-historicalCostConfirmed" disabled={viewer} checked={n.historicalCostConfirmed}
              onChange={(e) => patch((s) => changeNarrative(s, { historicalCostConfirmed: e.target.checked }))} />
            <span>Potrjujem, da so postavke izkazane po izvirni vrednosti (70.a člen), vključno z izključenimi naložbenimi in holding subjekti glede na poseben režim v profilu.</span>
          </label>
        </>
      )}

      <section className="space-y-2 rounded-md border p-3">
        <h4 className="text-sm font-semibold">Predlog razporeditve dobička ali pokritja izgube</h4>
        <Field id="proposal-text" label="Besedilo predloga" max={20000} rows={4} viewer={viewer} value={n.profitProposal.text} onChange={(v) => patch((s) => changeNarrative(s, { proposal: { text: v } }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Line id="proposal-by" label="Pripravil" viewer={viewer} value={n.profitProposal.preparedBy} onChange={(v) => patch((s) => changeNarrative(s, { proposal: { preparedBy: v } }))} />
          <Line id="proposal-date" label="Datum priprave" type="date" viewer={viewer} value={n.profitProposal.preparedDate} onChange={(v) => patch((s) => changeNarrative(s, { proposal: { preparedDate: v } }))} />
        </div>
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h4 className="text-sm font-semibold">Sprejeti sklep o uporabi dobička ali pokritju izgube</h4>
        <p className="text-xs text-muted-foreground">Sklep je ločen od predloga. Besedilo, datum in sklic vnesite po dejanskem sklepu; sprememba katerega koli polja prekliče potrditev sprejetja.</p>
        <Field id="decision-text" label="Besedilo sklepa" max={20000} rows={4} viewer={viewer} value={n.profitDecision.text} onChange={(v) => patch((s) => changeNarrative(s, { decision: { text: v } }))} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Line id="decision-by" label="Sprejel organ" viewer={viewer} value={n.profitDecision.adoptedBy} onChange={(v) => patch((s) => changeNarrative(s, { decision: { adoptedBy: v } }))} />
          <Line id="decision-date" label="Datum sklepa" type="date" viewer={viewer} value={n.profitDecision.adoptedDate} onChange={(v) => patch((s) => changeNarrative(s, { decision: { adoptedDate: v } }))} />
          <Line id="decision-ref" label="Sklic" viewer={viewer} value={n.profitDecision.reference} onChange={(v) => patch((s) => changeNarrative(s, { decision: { reference: v } }))} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" data-nav data-testid="nar-decision-adopted" disabled={viewer} checked={n.profitDecision.adopted}
            onChange={(e) => patch((s) => changeNarrative(s, { decision: { adopted: e.target.checked } }))} />
          <span>Sklep je bil dejansko sprejet</span>
        </label>
      </section>

      {simplified && (
        <section className="space-y-2 rounded-md border p-3" data-testid="simplified-section">
          <h4 className="text-sm font-semibold">Izjava za poenostavljeno oddajo</h4>
          <Field id="simplified-text" label="Besedilo izjave" max={5000} rows={3} viewer={viewer} value={n.simplifiedStatement.text} onChange={(v) => patch((s) => changeNarrative(s, { statement: { text: v } }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Line id="simplified-signatory" label="Podpisnik" viewer={viewer} value={n.simplifiedStatement.signatory} onChange={(v) => patch((s) => changeNarrative(s, { statement: { signatory: v } }))} />
            <Line id="simplified-date" label="Datum" type="date" viewer={viewer} value={n.simplifiedStatement.date} onChange={(v) => patch((s) => changeNarrative(s, { statement: { date: v } }))} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" data-nav data-testid="nar-simplified-confirmed" disabled={viewer} checked={n.simplifiedStatement.confirmed}
              onChange={(e) => patch((s) => changeNarrative(s, { statement: { confirmed: e.target.checked } }))} />
            <span>Potrjujem vsebino izjave (izjava priprave, ne elektronski podpis in ne dokaz oddaje).</span>
          </label>
        </section>
      )}

      <section className="space-y-1 rounded-md border p-3" aria-label="Popolnost besedil">
        <h4 className="text-sm font-semibold">Popolnost po dokumentih (strežnik)</h4>
        {!pa ? <p className="text-sm text-muted-foreground">Ocena besedil ni na voljo.</p> : (
          <>
            {dirty && <p className="text-xs text-amber-700 dark:text-amber-400">Neshranjene spremembe: ocena velja za zadnje shranjeno stanje.</p>}
            {!pa.supported && <p className="text-xs text-muted-foreground">Za ta profil izvoz besedil ni podprt; osnutek lahko urejate in shranite.</p>}
            <ul className="text-sm divide-y">
              {pa.documents.map((d) => (
                <li key={d.code} data-testid={`pubdoc-${d.code}`} className="py-1 flex gap-2 items-center">
                  <span>{d.label}</span><Badge variant={d.status === "present" ? "default" : "secondary"}>{DOC_STATUS[d.status] ?? d.status}</Badge>
                </li>
              ))}
            </ul>
            {pa.issues.map((i, k) => <div key={`${i.code}-${k}`} className={`text-sm ${i.blocking ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>{i.blocking && <Badge variant="destructive" className="mr-2">Blokira</Badge>}{i.message}</div>)}
          </>
        )}
      </section>
    </div>
  );
}

export function PublicationPreview({ report }: { report: AjpesAnnualReport }) {
  const pa = report.publicationAssessment;
  return (
    <section className="space-y-3" aria-label="Predogled besedil">
      <h3 className="text-sm font-semibold">Besedila letnega poročila</h3>
      {!pa || pa.sections.length === 0 ? (
        <p data-testid="sections-empty" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Besedil za predogled ni. Vnesite jih v zavihku Besedila in shranite.</p>
      ) : pa.sections.map((s) => (
        <article key={s.code} data-testid={`section-${s.code}`} className="rounded-md border p-3">
          <h4 className="text-sm font-medium mb-1">{s.label}</h4>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.text}</p>
        </article>
      ))}
    </section>
  );
}
