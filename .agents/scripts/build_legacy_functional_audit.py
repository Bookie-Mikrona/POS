"""Build a self-contained audit report and CSV without touching business data."""
import csv
import hashlib
import html
import json
from collections import Counter
from pathlib import Path

root = Path(".")
spec = json.loads(Path("docs/bookie-old-functional-audit-2026-10-06.json").read_text())
inventory = json.loads(Path("/tmp/bookie-functional-audit/inventory.json").read_text())
out = Path("reports")
out.mkdir(exist_ok=True)
statuses = ["Izvedeno", "Delno", "Manjka", "Še ni preverjeno"]
counts = Counter(row["status"] for row in spec["rows"])
for row in spec["rows"]:
    assert row["status"] in statuses
    for key in row["source"]:
        assert key in spec["sources"]
    for path in row["evidence"]:
        if not Path(path).exists():
            raise RuntimeError(f"{row['id']}: evidence does not exist: {path}")
for group in spec["sources"].values():
    for path in group:
        assert Path(path).exists(), path

def esc(value):
    return html.escape(str(value), quote=True)

def codepaths(paths):
    return "<br>".join(f"<code>{esc(path)}</code>" for path in paths)

def classify(entry):
    path = Path(entry["file"])
    name = path.name.lower()
    index = entry["index"]
    if index in {198, 199, 200, 205}:
        return "Prepoznan zaslon starega programa"
    if entry["extension"] in {".png", ".jpg", ".jpeg"}:
        return "Kontaktni pregled: novi ERP/POS, tehnični ali integracijski posnetek; podrobna zahteva ni preverjena"
    if any(key in name for key in ["payten", "bankart", "ecr_spec", "tiskal", "bridge", "zcs", "nb80"]) or entry["extension"] in {".apk", ".exe", ".kt", ".java", ".bat", ".ps1"}:
        return "POS/naprave/tehnično gradivo; zunaj pregleda funkcionalne nadomestitve starega ERP"
    if any(key in name for key in ["kpz", "iop", "bilanca(4)", "zaklj_rac", "promet_par", "obrazec4"]) or name.startswith(("ir_", "pr_")):
        return "Referenčni izpis starega ERP; PDF prva stran, celotna numerična primerjava ni opravljena"
    if name.startswith(("0_ziro", "1_zapiranje", "2_promet", "3_sifrant", "4_partner", "5_glavna", "promet1", "obrazec_", "glavna_", "partner_", "promet_", "obrazec_", "zapiranje_")) or entry["extension"] == ".sch":
        return "Zgodovinski podatkovni vir/shema; ni ponovno pregledan po vseh vrsticah"
    if any(key in name for key in ["bruto-bilanca-", "kartica-partnerja-"]):
        return "Izpis novega programa; ni avtoritativna stara referenca"
    if "docscan" in name:
        return "Skenirane listine; samo prva stran upodobljena, novi OCR ni izveden"
    if entry["extension"] == ".docx" or entry["extension"] == ".md" or "specifikacija-erp" in name or "debata_razvoj" in name:
        return "ERP razvojna/importna specifikacija; zahteve združene v matriki, ne vsaka tehnična podrobnost"
    if any(key in name for key in ["jolp", "ddv_kir_kpr", "edavki_"]):
        return "Referenca uradnega obrazca; ni izvedena zunanja oddaja"
    if "kont" in name:
        return "Kontni načrt/preslikava; polna veljavnost vseh kod ni ponovno preverjena"
    if entry["extension"] in {".zip", ".tif", ".doc", ".sql"}:
        return "Popisano; vsebina arhiva/slike/schema ni podrobno funkcionalno pregledana"
    return "Popisano; posamezna vsebina ni podrobno pregledana in ni uporabljena kot dokaz izvedbe"

for entry in inventory:
    entry["audit_class"] = classify(entry)
with (out / "bookie-old-priloge-popis-2026-10-06.csv").open("w", encoding="utf-8-sig", newline="") as file:
    writer = csv.writer(file)
    writer.writerow(["Indeks", "Datoteka", "Bajti", "Format", "SHA256", "Obseg pregleda"])
    writer.writerows([e["index"], e["file"], e["bytes"], e["extension"], e["sha256"], e["audit_class"]] for e in inventory)
with (out / "bookie-old-funkcionalna-pokritost-2026-10-06.csv").open("w", encoding="utf-8-sig", newline="") as file:
    writer = csv.writer(file)
    writer.writerow(["ID", "Sklop", "Zahteva", "Status", "Prednost", "Izvor", "Dokazi", "Ugotovitev", "Naslednja kontrola"])
    for row in spec["rows"]:
        writer.writerow([row["id"], row["group"], row["requirement"], row["status"], row["priority"],
                         " | ".join(path for key in row["source"] for path in spec["sources"][key]),
                         " | ".join(row["evidence"]), row["finding"], row["next"]])

body = []
for row in spec["rows"]:
    body.append(f"""<tr class="requirement" data-status="{esc(row['status'])}">
<td><strong>{esc(row['id'])}</strong><br>{esc(row['group'])}<br><small>{esc(row['priority'])}</small></td>
<td><strong>{esc(row['requirement'])}</strong><p>{esc(row['finding'])}</p><p><b>Dalje:</b> {esc(row['next'])}</p></td>
<td><span class="status s{statuses.index(row['status'])}">{esc(row['status'])}</span></td>
<td><details><summary>Izvor in dokaz</summary><p><b>Predloženo / specifikacija</b><br>{codepaths(dict.fromkeys(path for key in row['source'] for path in spec['sources'][key]))}</p><p><b>Novi program / preizkus</b><br>{codepaths(row['evidence'])}</p></details></td></tr>""")
inventory_body = "".join(f"<tr><td>{e['index']:03}</td><td><code>{esc(e['file'])}</code></td><td>{esc(e['audit_class'])}</td><td>{e['bytes']:,}</td></tr>" for e in inventory)
summary = " · ".join(f"{esc(status)}: <b>{counts[status]}</b>" for status in statuses)
options = "".join(f"<option>{esc(status)}</option>" for status in statuses)
limitations = "".join(f"<li>{esc(note)}</li>" for note in spec["limitations"])
output = f"""<!doctype html>
<html lang="sl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bookie — pokritost gradiv starega programa</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#f4f6f8;color:#17212b;font:15px/1.55 system-ui,-apple-system,sans-serif}}main{{max-width:1360px;margin:auto;padding:38px 28px}}h1{{font-size:32px;line-height:1.2;margin:10px 0 18px}}h2{{margin-top:36px;font-size:23px}}h3{{font-size:18px}}p{{max-width:100ch}}a{{color:#164d80}}code{{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}}.intro,.note{{background:white;border-left:4px solid #194b78;padding:18px 22px}}.note{{border-color:#b3650c}}nav{{display:flex;gap:18px;flex-wrap:wrap;margin:22px 0}}.table-wrap{{overflow-x:auto;background:white;border:1px solid #d6dce4}}table{{width:100%;border-collapse:collapse}}th,td{{padding:13px;text-align:left;vertical-align:top;border-bottom:1px solid #d6dce4}}th{{background:#e8eef5;font-size:13px}}td:nth-child(1){{width:14%}}td:nth-child(2){{width:45%}}td:nth-child(3){{width:14%}}td:nth-child(4){{width:27%}}td p{{margin:7px 0}}.status{{display:inline-block;font-weight:700;font-size:12px;padding:5px 8px;border-radius:4px;white-space:nowrap}}.s0{{background:#e1f1e7;color:#185531}}.s1{{background:#fff0cf;color:#7c4800}}.s2{{background:#ffe4e0;color:#8b2620}}.s3{{background:#e8eef5;color:#254d76}}label{{font-weight:600}}input,select{{padding:10px;border:1px solid #8294a8;border-radius:4px;font:inherit}}input{{min-width:260px}}.filters{{display:flex;gap:18px;align-items:end;flex-wrap:wrap;margin:18px 0}}.filters label{{display:flex;flex-direction:column;gap:5px}}:focus-visible{{outline:3px solid #216fbb;outline-offset:3px}}summary{{cursor:pointer;color:#164d80}}small,.meta{{color:#556474}}.inventory td:nth-child(1){{width:5%}}.inventory td:nth-child(2){{width:45%}}.inventory td:nth-child(3){{width:40%}}.inventory td:nth-child(4){{width:10%}}footer{{margin-top:40px;border-top:1px solid #c7d0da;padding-top:14px;color:#556474}}[hidden]{{display:none!important}}@media(max-width:650px){{main{{padding:20px 14px}}h1{{font-size:26px}}table{{min-width:750px}}}}@media print{{body{{background:white;font-size:10px}}main{{padding:0}}.filters,nav{{display:none}}table{{min-width:0!important}}details>p{{display:block}}.table-wrap{{overflow:visible}}tr{{break-inside:avoid}}h2{{break-after:avoid}}}}
</style></head><body><main>
<div class="meta">BOOKIE ERP · RAZVOJNI PREGLED · 6. oktober 2026</div><h1>Ali so gradiva starega programa implementirana?</h1>
<div class="intro"><p><strong>Ne v celoti. Pomembni postopki so izvedeni, nekaj zahtev je konkretno nedokončanih, za del pa še manjka dokaz ujemanja z vašo referenco.</strong></p>
<p>Ta pregled loči razvoj funkcij, prenos zgodovinskih podatkov in preverjanje rezultatov. Ne ustvarja knjižb, plačil ali davčnih oddaj. Vaši potrjeni izvorni podatki ostajajo referenca.</p>
<p><strong>{len(spec['rows'])} združenih funkcionalnih zahtev:</strong> {summary}.</p>
<p>To niso odstotki dokončanosti projekta: zahteve imajo različen obseg, del širše zasnove pa je predviden za poznejše faze.</p></div>
<nav><a href="#findings">Ključne ugotovitve</a><a href="#matrix">Matrika zahtev</a><a href="#method">Kaj je preverjeno</a><a href="#inventory">Vseh 279 prilog</a></nav>
<section id="findings"><h2>Kaj je dejansko nedokončano in kaj je samo nepreverjeno?</h2>
<ol><li><b>DDV-O XML: konkretno nedokončano.</b> Gumb »Prenesi XML« v zavihku DDV-O nima povezane izvedbe. KIR/KPR XML je druga datoteka in tega ne nadomesti.</li>
<li><b>Kartica, zapiranja in plačilni paketi: niso zgolj osnutki.</b> Najdeni so uporabniški zasloni in strežniške poti. Vseh vaših postavk in starih podrobnosti pa ne moremo označiti kot usklajene brez celovite primerjave.</li>
<li><b>Samostojni RP-O, PD-O in DDPO: izvedba ni najdena.</b> Naziv DDPO konta ni davčni obračun. Obveznost obrazca je odvisna od podjetja in poslov.</li>
<li><b>AJPES: precej več je že narejeno, kot kaže starejši osnutek.</b> Profili, besedila, podprti letni izvozi in arhiv obstajajo; preverjena podpora je omejena na 2025 in podprte običajne profile. Posebni paketi in drugi letniki niso s tem rešeni.</li>
<li><b>Uvoz v banko, AJPES in eDavke: ni dokazan s tem pregledom.</b> Uspešno generiranje ali lokalni test datoteke ne dokazuje uradnega sprejema.</li>
<li><b>Popolna zgodovinska primerjava ostaja odprta.</b> Obstajajo predhodni primerjalni dokumenti in skripti, ne nov popoln dokaz za vse vaše partnerje, listine in plačila.</li></ol>
<h3>Zakaj ni vse dokončano?</h3><p>Dokazljiva razlika je med (a) še nepovezano izvedbo, kot je DDV-O gumb, (b) izrecno omejenim oziroma poznejšim obsegom, kot so posebni AJPES paketi, in (c) izvedbo brez celovitega referenčnega preizkusa. Iz kode ni mogoče dokazati, zakaj je bil posamezni razvojni sklop v preteklem pogovoru odložen. Ta pregled zato ne izmišlja razlogov o prioritetah ali zahtevnosti.</p>
<p><b>Prednostni vrstni red:</b> dokončati nedelujoči uporabniški postopek DDV-O; nato vzpostaviti ponovljivo bralno primerjavo kartic, odprtih postavk, bilanc in plačil na istem datumu. Novi pogojni moduli sledijo dejanskim potrebam podjetja, ne samemu obstoju dolgoročnega načrta.</p></section>
<section id="matrix"><h2>Vsaka združena zahteva ima izvor, dokaz in naslednjo kontrolo</h2>
<p><b>Izvedeno:</b> najdena izvedba navedenega omejenega postopka. <b>Delno:</b> pomemben del obstaja, vendar ni pokrit celoten navedeni obseg. <b>Manjka:</b> nedokončan postopek ali izrecno nepodprta/najdena manjkajoča izvedba. <b>Še ni preverjeno:</b> dokaz ne zadostuje za trditev, da je zahteva izvedena ali manjka.</p>
<p>P1 = pomembno za zanesljivo nadomestitev starega postopka; P2 = naslednja razvojna/primerjalna dopolnitev; P3 = dodatek ali pogojni/poznejši obseg.</p>
<div class="filters"><label>Išči zahtevo ali dokaz<input id="search" type="search" placeholder="Npr. zapiranje, DDV-O, XML, datum"></label><label>Status<select id="status"><option value="">Vsi statusi</option>{options}</select></label><span id="result" aria-live="polite">{len(spec['rows'])} zahtev</span></div>
<div class="table-wrap"><table><thead><tr><th>Sklop / ID</th><th>Zahteva in ugotovitev</th><th>Status</th><th>Sledljivost</th></tr></thead><tbody>{''.join(body)}</tbody></table></div></section>
<section id="method"><h2>Dokazni obseg in omejitve</h2><p><b>113 lokalnih preizkusov v 13 datotekah je uspešnih; 0 neuspešnih.</b> Zajeti so izračuni kartic, dokumentna sled, PDF, SEPA, AJPES model/profili/besedila/XML in simulirane zaščite zgodovinskih plačil. To ni preizkus vseh ERP funkcij, vseh poslovnih podatkov ali uporabniške seje.</p><ul>{limitations}</ul>
<p>Pregled se opira na navedene datoteke in aktualno kodo v razvojnem okolju. Obstoječi osnutki se uporabljajo kot zahteve, ne kot avtoritativno aktualno stanje. Izvorne reference niso bile popravljene, da bi se ujemale z novim programom.</p></section>
<section id="inventory"><h2>Popis vseh trenutno prisotnih prilog</h2><p>279 datotek: 111 PNG/JPG/JPEG slik, 36 PDF, 83 TXT in 49 drugih datotek. Kontaktnim pregledom ni pripisana dokazna moč podrobnega pregleda. Celoten popis s SHA-256 je priložen tudi kot ločen CSV.</p>
<div class="table-wrap"><table class="inventory"><thead><tr><th>Indeks</th><th>Datoteka</th><th>Vloga / dejanski obseg pregleda</th><th>Bajti</th></tr></thead><tbody>{inventory_body}</tbody></table></div></section>
<footer>Razvojni posnetek 6. 10. 2026. Dokument ne potrjuje davčne oddaje, izvedbe bančnega plačila ali popolne funkcionalne skladnosti starega in novega programa. Brez zunanjih virov in brez zahtev do poslovnih API.</footer>
<script>
const search=document.getElementById('search'),status=document.getElementById('status'),rows=[...document.querySelectorAll('.requirement')];
function filter(){{const q=search.value.toLocaleLowerCase('sl-SI');let n=0;for(const row of rows){{row.hidden=!!((status.value&&row.dataset.status!==status.value)||(q&&!row.textContent.toLocaleLowerCase('sl-SI').includes(q)));if(!row.hidden)n++;}}document.getElementById('result').textContent=n+' / '+rows.length+' zahtev';}}
search.addEventListener('input',filter);status.addEventListener('change',filter);
</script></main></body></html>"""
report = out / "bookie-old-funkcionalna-pokritost-2026-10-06.html"
report.write_text(output, encoding="utf-8")
assert report.stat().st_size < 5_242_880
assert len(spec["rows"]) == len({r["id"] for r in spec["rows"]})
assert len(inventory) == 279
assert sum(counts.values()) == len(spec["rows"])
print(json.dumps({"requirements": len(spec["rows"]), "statuses": counts,
                  "uploads": len(inventory), "unique_upload_hashes":len({e["sha256"] for e in inventory}),
                  "report_bytes": report.stat().st_size, "report":str(report)},ensure_ascii=False))
