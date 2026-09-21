/**
 * bizbox.ts — Faza B: oddaja e-SLOG dokumentov prek bizBox (ZZI) API.
 *
 * Poverilnice se berejo IZKLJUČNO iz okoljskih spremenljivk BIZBOX_USER in
 * BIZBOX_PASS. Nikoli niso hardkodirane, shranjene v bazi ali logirane.
 *
 * API kontrakt (potrjen na demo okolju, referenca: bizbox_send.cpp):
 *   Gostitelja: TEST = demo.zzi.si, PROD = ws.zzi.si, port 443, HTTPS
 *   Bazna pot:  /eStoritveRest/EStoritveRest
 *
 * OpenAPI spec 2.0.1 (EStoritveRest):
 *   POST /login?userName=&password=       → GUID (1h session)
 *   POST /documents?guid=&isArchived=     → result = integer (int64) = docId
 *   GET  /documents/{docId}/metaData?guid= → MetaData objekt
 *   POST /companies/isEdiEnabled/{taxIdFrom}?guid= body=text/plain(taxIdTo) → string
 *
 * Opozorilo o formatu (beleženo za prihodnje preglede):
 *   Faza A generira e-SLOG 2.0 v UBL 2.1 sintaksi. Referenčni bizBox primeri
 *   so v EDIFACT sintaksi. Usmerjanje (envelope) deluje v obeh primerih, A NI
 *   potrjeno, da bizBox/prejemnik sprejme UBL-sintaktični e-SLOG. Dejanski
 *   sprejem je treba preveriti s testnim pošiljanjem na demo.zzi.si.
 *   Generatorja Faze A (UBL 2.1) NE spreminjamo brez izrecne potrditve.
 */

import JSZip from "jszip";

const BASE_PATH = "/eStoritveRest/EStoritveRest";

export type BizboxHost = "demo.zzi.si" | "ws.zzi.si";

/**
 * Vrne gostitelja glede na nastavitev okolja.
 * PRODUKCIJA (ws.zzi.si) se aktivira SAMO, če je okolje eksplicitno 'prod'.
 * Privzeto in za vse ostale vrednosti: testno/demo okolje.
 */
export function getBizboxHost(okolje: string | undefined): BizboxHost {
  return okolje === "prod" ? "ws.zzi.si" : "demo.zzi.si";
}

/**
 * Prijava na bizBox API.
 * Poverilnici se posredujeta kot parametra — klic iz route bere env in NIKOLI
 * jih ne logira.
 *
 * @returns JWT/session žeton za nadaljnje klice
 */
export async function loginBizbox(host: BizboxHost, user: string, pass: string): Promise<string> {
  const urlEncUser = encodeURIComponent(user);
  const urlEncPass = encodeURIComponent(pass);
  const url = `https://${host}${BASE_PATH}/login?userName=${urlEncUser}&password=${urlEncPass}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `userName=${urlEncUser}&password=${urlEncPass}`,
  });

  if (resp.status !== 200 && resp.status !== 201) {
    const body = await resp.text().catch(() => "");
    throw new Error(`bizBox login spodletel: HTTP ${resp.status} — ${body.slice(0, 200)}`);
  }

  const body = await resp.text();

  // Poskusi JSON razčleniti in poišči žeton v znanih poljih
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const token =
      json["token"] ??
      json["access_token"] ??
      json["jwt"] ??
      json["accessToken"] ??
      json["sessionToken"] ??
      json["sessionId"];
    if (token && typeof token === "string" && token.trim().length > 0) {
      return token.trim();
    }
  } catch {
    // Ni JSON — golo telo je žeton
  }

  // Golo telo (obrezano)
  const rawToken = body.trim();
  if (rawToken.length === 0) {
    throw new Error("bizBox login: prazno telo odgovora — žeton ni na voljo");
  }
  return rawToken;
}

/**
 * Zgradi envelope.xml (točna oblika, potrjena na resničnem bizBox paketu).
 *
 * @param from      eDDress pošiljatelja, npr. "SI12345678"
 * @param to        eDDress prejemnika, npr. "SI84040000"
 * @param docFileName  ime dokumentne datoteke v ZIP, npr. "eracun-26000001.xml"
 * @param extId     zunanji ID za idempotentnost (npr. številka računa)
 */
export function buildEnvelope(
  from: string,
  to: string,
  docFileName: string,
  extId: string,
): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<envelope><header>\n` +
    ` <from><e_address>${escXml(from)}.HQ</e_address><e_location>C:${escXml(from)}</e_location></from>\n` +
    ` <to><e_address>${escXml(to)}.HQ</e_address><e_address1>${escXml(to)}</e_address1><e_location>C:${escXml(to)}</e_location></to>\n` +
    `</header><document>\n` +
    ` <external_id>${escXml(extId)}</external_id><type>INVOIC</type><format>ESLOG.2_0</format>\n` +
    ` <file_name>${escXml(docFileName)}</file_name><description>Račun</description>\n` +
    `</document></envelope>`
  );
}

/**
 * Zgradi ZIP paket (STORE — brez kompresije, kot zahteva referenčni sender).
 *
 * @param files  seznam { name, bytes } — prvi mora biti envelope.xml, drugi dokument XML
 */
export async function buildZip(files: Array<{ name: string; bytes: Buffer | Uint8Array | string }>): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.name, f.bytes, {
      compression: "STORE",  // brez kompresije — referenca uporablja STORE
    });
  }
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });
  return zipBuffer;
}

/**
 * Pošlje ZIP paket na bizBox /documents endpoint.
 *
 * @param host          gostitelj (demo ali produkcija)
 * @param token         žeton iz loginBizbox
 * @param envelopeXml   vsebina envelope.xml
 * @param docFileName   ime dokumentne datoteke v ZIP (brez poti)
 * @param docBytes      vsebina e-SLOG XML dokumenta
 * @param isArchived    privzeto false
 * @returns { status, body }
 */
export async function posljiBizbox(
  host: BizboxHost,
  token: string,
  envelopeXml: string,
  docFileName: string,
  docBytes: Buffer | string,
  isArchived = false,
): Promise<{ status: number; body: string }> {
  const zipBuffer = await buildZip([
    { name: "envelope.xml", bytes: Buffer.from(envelopeXml, "utf-8") },
    { name: docFileName, bytes: typeof docBytes === "string" ? Buffer.from(docBytes, "utf-8") : docBytes },
  ]);

  const url = `https://${host}${BASE_PATH}/documents?guid=${encodeURIComponent(token)}&isArchived=${isArchived}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: zipBuffer,
  });

  const body = await resp.text().catch(() => "");

  if (resp.status !== 200 && resp.status !== 201 && resp.status !== 202) {
    throw new Error(
      `bizBox /documents HTTP ${resp.status}: ${body.slice(0, 300)}`,
    );
  }

  return { status: resp.status, body };
}

/**
 * Razčleni docId (result = integer/int64) iz telesa odgovora POST /documents.
 *
 * Odgovor je lahko:
 *   - golo celo število: "12345"
 *   - JSON: {"result": 12345, ...} ali {"id": 12345}
 *
 * @returns docId kot string (brez izgube preciznosti) ali null
 */
export function parseBizboxDocId(body: string): string | null {
  const trimmed = body.trim();

  // Poskusi JSON: {"result": 12345} ali {"id": 12345}
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["result", "id", "docId", "documentId", "document_id"]) {
      const v = json[key];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        return String(Math.round(v));
      }
      if (typeof v === "string" && /^\d+$/.test(v.trim()) && Number(v.trim()) > 0) {
        return v.trim();
      }
    }
  } catch { /* ni JSON */ }

  // Golo celo število
  if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) {
    return trimmed;
  }

  return null;
}

/**
 * Preveri status dostave dokumenta prek GET /documents/{docId}/metaData.
 *
 * OpenAPI 2.0.1: GET /documents/{docId}/metaData?guid= → MetaData
 *
 * Mapiranje:
 *   200 + status=DELIVERED/dostavljeno → "dostavljeno"
 *   200 + status=REJECTED/zavrnjeno   → "zavrnjeno"
 *   200 (brez statusnega polja)        → "v_obdelavi" (dokument obstaja, dostava v teku)
 *   404 / 204 / prazno telo            → "v_obdelavi" (morda še ni obdelano)
 *   HTTP napaka                        → izjema
 *
 * @param host   gostitelj (demo ali produkcija)
 * @param token  žeton iz loginBizbox
 * @param docId  document ID shranjen ob oddaji (string da ohranimo int64 preciznost)
 */
export async function getBizboxDocMetadata(
  host: BizboxHost,
  token: string,
  docId: string,
): Promise<{ bizboxStatus: "v_obdelavi" | "dostavljeno" | "zavrnjeno"; raw: string }> {
  const url = `https://${host}${BASE_PATH}/documents/${encodeURIComponent(docId)}/metaData?guid=${encodeURIComponent(token)}`;

  const resp = await fetch(url, { method: "GET" });
  const raw = await resp.text().catch(() => "");

  // 404/204 ali prazno telo — dokument morda še v obdelavi
  if (resp.status === 404 || resp.status === 204 || raw.trim().length === 0) {
    return { bizboxStatus: "v_obdelavi", raw };
  }

  if (resp.status !== 200 && resp.status !== 201) {
    throw new Error(`bizBox /documents/${docId}/metaData HTTP ${resp.status}: ${raw.slice(0, 200)}`);
  }

  // Poišči statusno polje v JSON odgovoru
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const status = String(
      json["status"] ?? json["deliveryStatus"] ?? json["state"] ?? json["dostava"] ?? ""
    ).toLowerCase();

    if (
      status.includes("delivered") ||
      status.includes("dostavlj") ||
      status === "ok" ||
      status === "success"
    ) {
      return { bizboxStatus: "dostavljeno", raw };
    }
    if (
      status.includes("reject") ||
      status.includes("zavrnj") ||
      status.includes("failed") ||
      status.includes("error") ||
      status.includes("napaka")
    ) {
      return { bizboxStatus: "zavrnjeno", raw };
    }
  } catch { /* ni JSON ali ni statusnega polja */ }

  // Dokument obstaja v bizBox (200 brez eksplicitnega statusa) — v obdelavi
  return { bizboxStatus: "v_obdelavi", raw };
}

/**
 * Preveri, ali je prejemnik registriran v bizBox omrežju (isEdiEnabled).
 *
 * OpenAPI 2.0.1:
 *   POST /companies/isEdiEnabled/{taxIdFrom}?guid=[&dotName=]
 *   Body: text/plain → taxIdTo (eDDress ali davčna prejemnika)
 *   Odgovor: string ("true"/"false" ali JSON)
 *
 * Informativna predpreverba — ne vrže napake, samo sporoči rezultat.
 *
 * @param host         gostitelj
 * @param token        žeton iz loginBizbox
 * @param fromEddress  eDDress pošiljatelja (npr. "SI11928174")
 * @param toEddress    eDDress ali davčna prejemnika (npr. "SI84040000")
 * @returns { enabled, raw } — enabled=true pomeni prejemnik je na bizBox
 */
export async function preveriEdiEnabled(
  host: BizboxHost,
  token: string,
  fromEddress: string,
  toEddress: string,
): Promise<{ enabled: boolean; raw: string }> {
  const fromId = encodeURIComponent(fromEddress);
  const url = `https://${host}${BASE_PATH}/companies/isEdiEnabled/${fromId}?guid=${encodeURIComponent(token)}`;

  let resp: Response;
  let raw: string;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: toEddress,
    });
    raw = await resp.text().catch(() => "");
  } catch (err) {
    // Omrežna napaka — ne blokiramo oddaje
    return { enabled: false, raw: String(err) };
  }

  if (resp.status !== 200 && resp.status !== 201) {
    return { enabled: false, raw: `HTTP ${resp.status}: ${raw.slice(0, 100)}` };
  }

  // Odgovor je string: "true"/"false" ali JSON {result: "..."}
  const trimmed = raw.trim().toLowerCase();
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const r = json["result"] ?? json["enabled"] ?? json["isEnabled"] ?? json["isEdiEnabled"];
    if (typeof r === "boolean") return { enabled: r, raw };
    if (typeof r === "string") {
      return {
        enabled: r.toLowerCase() === "true" || r.toLowerCase() === "yes" || r.toLowerCase() === "1",
        raw,
      };
    }
  } catch { /* ni JSON */ }

  const enabled =
    trimmed === "true" ||
    trimmed === "yes" ||
    trimmed === "1" ||
    trimmed.startsWith("true") ||
    trimmed.includes('"enabled":true');
  return { enabled, raw };
}

/**
 * Sestavi eDDress iz davčne številke.
 * Oblika: "SI" + 8-mestna davčna (brez SI predpone, ki je morda že vključena).
 * Če je podan direktni eDDress (eRacunNaslov), ga vrni nespremenjenega.
 */
export function sestaviEddress(davcna: string, eRacunNaslov?: string | null): string {
  if (eRacunNaslov && eRacunNaslov.trim().length > 0) {
    return eRacunNaslov.trim();
  }
  // Odstrani SI/si predpono, ki je morda prisotna, in dodaj "SI"
  const cista = davcna.replace(/^SI/i, "").trim();
  return `SI${cista}`;
}

// ── Pomožna: HTML entity escape za XML atribute/vsebino ──────────────────────
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
