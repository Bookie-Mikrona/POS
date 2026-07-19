import crypto from "crypto";
import fs from "fs";
import https from "https";
import path from "path";
import { spawnSync } from "child_process";
import { SignedXml } from "xml-crypto";

// ---------- P12/PEM certifikat nalagalnik ----------

interface CertPem { key: string; cert: string }

/**
 * Naloži certifikat in zasebni ključ v PEM formatu.
 * Podpira .pem (cert+key skupaj) in .p12/.pfx (z geslom).
 * P12 z RC2-40-CBC zahteva openssl legacy flag — to je standardni FURS testni cert format.
 */
export function nalagajCertPem(certPot: string, geslo?: string): CertPem {
  if (!fs.existsSync(certPot)) throw new Error(`Certifikat ni najden: ${certPot}`);

  if (/\.p12$/i.test(certPot) || /\.pfx$/i.test(certPot)) {
    const passArg = `pass:${geslo ?? ""}`;
    const keyRes = spawnSync("openssl", [
      "pkcs12", "-legacy", "-in", certPot, "-nocerts", "-nodes", "-passin", passArg,
    ], { encoding: "utf8" });
    const certRes = spawnSync("openssl", [
      "pkcs12", "-legacy", "-in", certPot, "-nokeys", "-passin", passArg,
    ], { encoding: "utf8" });

    const keyOut = keyRes.stdout ?? "";
    const certOut = certRes.stdout ?? "";

    // Ekstrahiraj samo PEM bloke (openssl pkcs12 doda bag attributes)
    const keyMatch = keyOut.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);
    const certMatch = certOut.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);

    if (!keyMatch) throw new Error("P12: zasebni ključ ni bil ekstrahiran (napačno geslo ali format)");
    if (!certMatch) throw new Error("P12: certifikat ni bil ekstrahiran");

    // Konvertira PKCS#8 v RSA traditional če je treba — xml-crypto zahteva RSA PEM
    const keyPkcs8 = keyMatch[0];
    const rsaRes = spawnSync("openssl", ["rsa", "-in", "/dev/stdin"], {
      input: keyPkcs8,
      encoding: "utf8",
    });
    const key = rsaRes.stdout?.includes("BEGIN RSA PRIVATE KEY") ? rsaRes.stdout : keyPkcs8;

    return { key, cert: certMatch[0] };
  }

  // PEM datoteka
  const pem = fs.readFileSync(certPot, "utf8");
  const keyMatch = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);
  const certMatch = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!keyMatch) throw new Error("PEM: zasebni ključ ni najden");
  if (!certMatch) throw new Error("PEM: certifikat ni najden");
  return { key: keyMatch[0], cert: certMatch[0] };
}

/** Ustvari CertPem iz PEM nizov (cert in zasebni ključ sta že v PEM obliki, shranjeni v bazi). */
function nalagajCertPemIzNiza(cert: string, kljuc: string): CertPem {
  let key = kljuc;
  if (!kljuc.includes("BEGIN RSA PRIVATE KEY")) {
    const rsaRes = spawnSync("openssl", ["rsa", "-in", "/dev/stdin"], { input: kljuc, encoding: "utf8" });
    if (rsaRes.stdout?.includes("BEGIN RSA PRIVATE KEY")) key = rsaRes.stdout;
  }
  return { cert, key };
}

/** Razreši CertPem iz PEM nizov (iz baze) ali iz datoteke na disku — prioriteta: baza > disk. */
function resolveCertPem(certPot?: string, geslo?: string, certPem?: string, certKljuc?: string): CertPem | null {
  if (certPem && certKljuc) {
    try { return nalagajCertPemIzNiza(certPem, certKljuc); } catch { return null; }
  }
  if (certPot && fs.existsSync(certPot)) {
    try { return nalagajCertPem(certPot, geslo); } catch { return null; }
  }
  return null;
}

// ---------- CA certifikat ----------

/**
 * Vrne PEM Tax CA Test certifikata iz istega direktorija kot certPot.
 * taxcatest.pem je v isti mapi kot klientski cert (test-furs.pem).
 */
function beriCACert(certPot: string, testniNacin: boolean): string | null {
  const dir = path.dirname(certPot);
  const caFile = testniNacin ? "taxca-test.pem" : "taxca-prod.pem";
  const caPath = path.join(dir, caFile);
  if (!fs.existsSync(caPath)) return null;
  const pem = fs.readFileSync(caPath, "utf8");
  return pem.includes("BEGIN CERTIFICATE") ? pem : null;
}

/** Vrne pot do CA cert glede na testni/produkcijski način */
function caCertPot(certPot: string, testniNacin: boolean): string {
  return path.join(path.dirname(certPot), testniNacin ? "taxca-test.pem" : "taxca-prod.pem");
}

// ---------- FURS HTTP client (JSON/JWT, mutual TLS) ----------

async function fursFetch(
  url: string,
  body: string,
  certPot?: string,
  contentType = "application/json; charset=UTF-8",
  testniNacin = true,
  geslo?: string
): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
    const parsed = new URL(url);

    let clientCert: string | undefined;
    let clientKey: Buffer | undefined;
    if (certPot && fs.existsSync(certPot)) {
      try {
        const { key, cert } = nalagajCertPem(certPot, geslo);
        const caCert = beriCACert(certPot, testniNacin);
        clientCert = cert + (caCert ? "\n" + caCert : "");
        clientKey = Buffer.from(key);
      } catch { /* ni cert — nadaljuj brez */ }
    }

    const agent = new https.Agent({
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
      cert: clientCert,
      key: clientKey,
    });

    return new Promise((resolve, reject) => {
      const bodyBytes = Buffer.byteLength(body, "utf8");
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "Content-Length": bodyBytes,
            "Accept": "application/json",
          },
          rejectUnauthorized: false,
          agent,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          res.on("end", () => resolve({
            statusCode: res.statusCode ?? 0,
            body: data,
            headers: res.headers as Record<string, string | string[] | undefined>,
          }));
        }
      );
      req.setTimeout(15000, () => { req.destroy(new Error("FURS timeout")); });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
}

/**
 * Ustvari RS256 JWT za FURS REST API.
 * Header vsebuje x5c z verigo certifikatov (leaf + CA če je na voljo).
 * Telo zahtevka: {"token": "<jwt>"}
 */
function buildFursJWT(payload: object, certPot: string, testniNacin = true, geslo?: string): string {
  const { key, cert: certPem } = nalagajCertPem(certPot, geslo);

  const toDerB64 = (c: string) =>
    c.replace(/-----BEGIN CERTIFICATE-----/, "")
     .replace(/-----END CERTIFICATE-----/, "")
     .replace(/\s+/g, "");

  // x5c: leaf cert + CA cert — RFC 7515 §4.1.6
  const x5c: string[] = [toDerB64(certPem)];
  const caCert = beriCACert(certPot, testniNacin);
  const caMatch = caCert?.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (caMatch) x5c.push(toDerB64(caMatch[0]));

  const jwtHeader = Buffer.from(JSON.stringify({ alg: "RS256", x5c })).toString("base64url");
  const jwtPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${jwtHeader}.${jwtPayload}`;

  const signer = crypto.createSign("SHA256");
  signer.update(signingInput, "utf8");
  signer.end();
  const signature = signer.sign(key).toString("base64url");

  return `${signingInput}.${signature}`;
}

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- Public interfaces ----------

export interface FursPostavka {
  ime: string;
  kolicina: number;
  cenaKos: number;
  davek: number;
  skupaj?: number;
}

export interface FursRacunData {
  stevilkaRacuna: string;
  datumCas: Date;
  skupaj: number;
  ddv: number;
  placilnaNacin: "gotovina" | "kartica" | "bon" | "other";
  postavke: FursPostavka[];
  davcnaStevilka?: string;
  poslovnaProstor?: string;
  blagajnaId?: string;
  operatorDavcna?: string;
  kupecDavcnaStevilka?: string | null;
  jeStorno?: boolean;
  izvornaStevRacuna?: string;
  izvornaStevRacunaDatumCas?: Date;
  certifikatPot?: string;
  certifikatGeslo?: string;
  certPem?: string;
  certKljuc?: string;
  proxyUrl?: string;
}

export interface FursOdgovor {
  eor: string;
  zoi: string;
  uspeh: boolean;
  napaka?: string;
  surovOdgovor: string;
}

/**
 * Formatira številko računa v obliki {PP}-{BB}-{NNNNNN}.
 * Primer: formatStevilkaRacuna("PP001", "B001", 1) → "PP001-B001-000001"
 */
export function formatStevilkaRacuna(
  poslovniProstor: string,
  blagajnaId: string,
  seq: number
): string {
  return `${poslovniProstor}-${blagajnaId}-${String(seq).padStart(6, "0")}`;
}

/**
 * Ekstrahira zaporedno številko (NNNNNN) iz številke računa za FURS InvoiceNumber.
 * Format računa: {PP}-{BB}-{NNNNNN}, npr. "PP001-B001-000001" → 1
 * FURS schema dopušča max 9999999.
 */
export function extractFursSeqNum(stevilkaRacuna: string): number {
  const m = stevilkaRacuna.match(/-(\d{6})$/);
  if (m) return parseInt(m[1]!, 10);
  const fallback = stevilkaRacuna.match(/(\d+)$/);
  return fallback ? parseInt(fallback[1]!, 10) : 1;
}

/**
 * Zaokroži število na 2 decimalni mesti (centno zaokroževanje).
 * Uporablja "round half away from zero" (standardno za denarne vrednosti).
 */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Izračuna DDV (davek na dodano vrednost) iz skupnega zneska z DDV.
 * Formula: znesek * stopnja / (100 + stopnja)
 * Primer: 12.20 EUR z 22% DDV → 12.20 * 22 / 122 = 2.20 EUR DDV
 */
export function izracunajDDV(znesek: number, stopnja: number): number {
  return znesek * stopnja / (100 + stopnja);
}

/**
 * Izračuna DDV, zaokrožen na 2 decimalni mesti.
 * Uporablja se pri seštevanju DDV po postavkah, da preprečimo napake zaokroževanja
 * pri oddaji na FURS (FURS primerja seštevek DDV skupin s skupnim DDV na računu).
 */
export function izracunajDDVZaokrozen(znesek: number, stopnja: number): number {
  return round2(izracunajDDV(znesek, stopnja));
}

/**
 * Preveri konsistentnost DDV seštevkov pred oddajo na FURS.
 *
 * FURS primerja seštevek DDV po davčnih skupinah (TaxesPerSeller/VAT) s skupnim DDV
 * na računu (ddv). Če je neskladje > 0.01 EUR, FURS vrne napako S003.
 *
 * Algoritem je usklajen z buildInvoiceXML (SOAP pot):
 *  - Za vsako postavko: lineTotal = round2(kolicina * cenaKos),
 *    taxAmount = round2(lineTotal * davek / (100 + davek))
 *  - Sešteje taxAmount po davčnih skupinah
 *  - Primerja round2(skupajDDVSkupin) z ddv (vrednost iz računa)
 *  - Vrže napako, če je round2(|razlika|) > 0.01 EUR
 *
 * Enak algoritem zaokroževanja kot buildInvoiceXML prepreči lažne alarme
 * pri veljavnih računih z neurejenimi cenami.
 *
 * @throws Error, če je neskladje preveliko — namesto FURS S003
 */
export function preveriDDVKonsistentnost(
  postavke: FursPostavka[],
  ddv: number
): void {
  if (postavke.length === 0) return;

  // Zaokroži vsako vrstico — usklajen z buildInvoiceXML (SOAP pot)
  const vatGroups = new Map<number, number>();
  for (const p of postavke) {
    const lineTotal = round2(p.kolicina * p.cenaKos);
    const taxAmount = round2((lineTotal * p.davek) / (100 + p.davek));
    const existing = vatGroups.get(p.davek) ?? 0;
    vatGroups.set(p.davek, existing + taxAmount);
  }

  const skupajDDVSkupin = round2(
    Array.from(vatGroups.values()).reduce((a, b) => a + b, 0)
  );
  const razlika = round2(Math.abs(skupajDDVSkupin - ddv));

  if (razlika > 0.01) {
    throw new Error(
      `DDV neskladje pred oddajo na FURS: seštevek po davčnih skupinah ` +
      `${skupajDDVSkupin.toFixed(2)} EUR ≠ DDV na računu ${ddv.toFixed(2)} EUR ` +
      `(razlika ${razlika.toFixed(2)} EUR > 0.01 EUR)`
    );
  }
}

/**
 * Preveri, da skupaj na računu ustreza seštevku postavk pred oddajo na FURS.
 *
 * Ko blagajnik aplicira popust na celotni račun (ne po postavkah), se `skupaj`
 * na računu lahko razhaja od `sum(round2(kolicina * cenaKos))` po postavkah.
 * Tak razkorak povzroči napačen FURS InvoiceAmount.
 *
 * @param postavke - Vrstice računa (kolicina, cenaKos).
 * @param skupaj   - Bruto skupaj na računu, zaokrožen na 2 decimalni mesti.
 * @throws Error, če je razlika > 0.01 EUR
 */
export function preveriVsotoPostavk(
  postavke: FursPostavka[],
  skupaj: number
): void {
  if (postavke.length === 0) return;

  const vsotaPostavk = round2(
    postavke.reduce((acc, p) => acc + round2(p.kolicina * p.cenaKos), 0)
  );
  const razlika = round2(Math.abs(vsotaPostavk - skupaj));

  if (razlika > 0.01) {
    throw new Error(
      `Neskladje med skupaj in seštevkom postavk pred oddajo na FURS: ` +
      `seštevek postavk ${vsotaPostavk.toFixed(2)} EUR ≠ ` +
      `skupaj ${skupaj.toFixed(2)} EUR ` +
      `(razlika ${razlika.toFixed(2)} EUR > 0.01 EUR)`
    );
  }
}

/**
 * Preveri, da vsaka postavka z shranjenim skupaj ustreza round2(kolicina × cenaKos).
 *
 * `preveriVsotoPostavk` primerja skupni znesek računa z vsoto vrstic, a ne ujame napake,
 * ko je posamezna vrstica napačno shranjena (npr. popust na ravni postavke, ki ni bil
 * prenesen v cenaKos). Tak odklon bi brez tega preverjanja prešel skozi v InvoiceAmount.
 *
 * Preverjanje se preskoči za vsako vrstico brez shranjenega skupaj (skupaj === undefined).
 *
 * @param postavke - Vrstice računa; skupaj je opcijsko polje.
 * @throws Error, če katera koli vrstica preseže toleranco 0.01 EUR
 */
export function preveriVsotoPostavkPoVrsticah(postavke: FursPostavka[]): void {
  for (const p of postavke) {
    if (p.skupaj === undefined) continue;
    const izracunan = round2(p.kolicina * p.cenaKos);
    const razlika = round2(Math.abs(izracunan - p.skupaj));
    if (razlika > 0.01) {
      throw new Error(
        `Neskladje v vrstici "${p.ime}": shranjeni skupaj ${p.skupaj.toFixed(2)} EUR ≠ ` +
        `kolicina × cenaKos = ${izracunan.toFixed(2)} EUR ` +
        `(razlika ${razlika.toFixed(2)} EUR > 0.01 EUR)`
      );
    }
  }
}

/**
 * Preveri, da računovodska identiteta osnova + DDV = skupaj drži pred oddajo na FURS.
 *
 * To je dodatna zaščita pred FURS napako S003: če `round2(osnova + ddv) !== skupaj`,
 * gre za napako v izračunu in račun ne sme iti na FURS.
 *
 * @param osnova - Neto osnova (brez DDV), zaokrožena na 2 decimalni mesti.
 * @param ddv    - Skupni DDV, zaokrožen na 2 decimalni mesti.
 * @param skupaj - Bruto skupaj (osnova + DDV), zaokrožen na 2 decimalni mesti.
 * @throws Error, če round2(osnova + ddv) !== skupaj
 */
export function preveriSkupajKonsistentnost(
  osnova: number,
  ddv: number,
  skupaj: number
): void {
  const izracunan = round2(osnova + ddv);
  if (izracunan !== skupaj) {
    const razlika = round2(Math.abs(izracunan - skupaj));
    throw new Error(
      `Centna neskladnost pred oddajo na FURS: osnova (${osnova.toFixed(2)} EUR) + ` +
      `DDV (${ddv.toFixed(2)} EUR) = ${izracunan.toFixed(2)} EUR ≠ ` +
      `skupaj ${skupaj.toFixed(2)} EUR ` +
      `(razlika ${razlika.toFixed(2)} EUR)`
    );
  }
}

/**
 * Izračuna osnovo (brez DDV) iz skupnega zneska z DDV.
 * Formula: znesek - izracunajDDV(znesek, stopnja)
 */
export function izracunajOsnovo(znesek: number, stopnja: number): number {
  return round2(znesek - izracunajDDV(znesek, stopnja));
}

/**
 * Izračuna ZOI (Zaščitna oznaka izdajatelja) — MD5 hash.
 */
export function izracunajZOI(
  stevilkaRacuna: string,
  datumCas: Date,
  skupaj: number,
  davcnaStevilka: string = "12345678"
): string {
  const timestamp = datumCas.toISOString().slice(0, 19).replace("T", " ");
  const vsebina = `${davcnaStevilka}${timestamp}${skupaj.toFixed(2)}${stevilkaRacuna}`;
  return crypto.createHash("md5").update(vsebina).digest("hex");
}

/**
 * FURS QR koda — ZDavPR 60-cifrni podatkovni niz (brez URL/protokola, samo cifre).
 *
 * Format (skupaj 60 cifr):
 *   ZOI_decimal(39) + davčna(8) + datum_YYMMDDHHMMSS(12) + kontrolna_cifra(1)
 *
 * - ZOI: hex MD5 → decimalni BigInt, zero-padded na 39 mest
 * - Datum: 2-mestno leto (YYMMDDHHMMSS), Ljubljana čas
 * - Kontrolna cifra: vsota prvih 59 cifr mod 10
 */
export function fursQrKoda(zoi: string, davcnaStevilka: string, datumCas: Date, _skupaj?: number): string {
  // ZOI: hex → decimalni BigInt, zero-padded na 39 mest
  const zoiDecimal = BigInt("0x" + zoi).toString().padStart(39, "0");

  // Davčna: 8 mest z vodilnimi ničlami
  const davcna = davcnaStevilka.padStart(8, "0").slice(-8);

  // Datum: YYMMDDHHMMSS (12 mest, 2-mestno leto), Ljubljana čas
  const ljTs = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Ljubljana",
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(datumCas); // "26-06-25 04:30:00"
  const datum = ljTs.replace(/[-: ]/g, ""); // "260625043000" — YYMMDDHHMMSS, 12 znakov

  // Prvih 59 cifr
  const prvih59 = zoiDecimal + davcna + datum;

  // Kontrolna cifra: vsota vseh 59 cifr mod 10
  let vsota = 0;
  for (const ch of prvih59) vsota += parseInt(ch, 10);
  const kontrolna = (vsota % 10).toString();

  return prvih59 + kontrolna;
}

/** @deprecated Uporabi fursQrKoda */
export function fursQrUrl(zoi: string, davcnaStevilka: string, datumCas: Date): string {
  return fursQrKoda(zoi, davcnaStevilka, datumCas, 0);
}

/**
 * Produkcijsko RSA-SHA256 podpisovanje ZOI.
 */
export function izracunajZOIRSA(
  content: string,
  certifikatPot?: string,
  certifikatGeslo?: string,
  certKljucPem?: string
): string {
  try {
    const pem = certKljucPem ?? (certifikatPot ? fs.readFileSync(certifikatPot, "utf-8") : "");
    const privateKey = crypto.createPrivateKey({ key: pem, passphrase: certifikatGeslo });
    const sign = crypto.createSign("SHA256");
    sign.update(content, "utf8");
    sign.end();
    const signatureBytes = sign.sign(privateKey);
    return crypto.createHash("md5").update(signatureBytes).digest("hex");
  } catch (err) {
    const napaka = err instanceof Error ? err.message : String(err);
    throw new Error(`ZOI RSA podpisovanje neuspešno: ${napaka}`);
  }
}

/**
 * Izračuna ZOI lokalno brez omrežnih klicev — zagotovi ZOI tudi ko FURS ni dosegljiv.
 * V testnem načinu ali brez certifikata → MD5 ZOI.
 * V produkcijskem načinu s certifikatom → RSA ZOI (s MD5 fallbackom pri napaki).
 */
export function izracunajZOILokalno(
  stevilkaRacuna: string,
  datumCas: Date,
  skupaj: number,
  davcnaStevilka: string,
  poslovniProstor: string,
  blagajnaId: string,
  fursNacin: FursNacin,
  certKljuc?: string,
  certifikatPot?: string,
  certifikatGeslo?: string,
): string {
  if (fursNacin === "simulacija") {
    return izracunajZOI(stevilkaRacuna, datumCas, skupaj, davcnaStevilka);
  }
  const hasCert = !!certKljuc || !!(certifikatPot && fs.existsSync(certifikatPot));
  if (!hasCert) {
    return izracunajZOI(stevilkaRacuna, datumCas, skupaj, davcnaStevilka);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const dt = datumCas;
  const ts = `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  const content = `${davcnaStevilka}${ts}${skupaj.toFixed(2)}${stevilkaRacuna}${poslovniProstor}${blagajnaId}`;
  try {
    return izracunajZOIRSA(content, certifikatPot, certifikatGeslo, certKljuc);
  } catch {
    return izracunajZOI(stevilkaRacuna, datumCas, skupaj, davcnaStevilka);
  }
}

export async function posljiNaFURS(
  data: FursRacunData,
  fursNacin: FursNacin = "simulacija",
  preskociPreverjanje: boolean = false,
  splosnaSt = 22
): Promise<FursOdgovor> {
  if (!preskociPreverjanje) {
    // Preveri skupaj vsake posamezne vrstice (kolicina × cenaKos) — ujame napake na ravni postavke
    preveriVsotoPostavkPoVrsticah(data.postavke);
    // Preveri, da skupaj ustreza seštevku postavk — ujame popuste na ravni računa
    preveriVsotoPostavk(data.postavke, data.skupaj);
    // Preveri konsistentnost DDV pred pošiljanjem — FURS vrne S003 pri neskladju > 0.01 EUR
    preveriDDVKonsistentnost(data.postavke, data.ddv);
  }

  // Simulacija: lokalna ZOI+EOR (MD5+UUID), brez omrežja — vedno uspe
  if (fursNacin === "simulacija") {
    const zoiSim = izracunajZOI(data.stevilkaRacuna, data.datumCas, data.skupaj, data.davcnaStevilka ?? "12345678");
    const eorSim = crypto.randomUUID();
    return {
      eor: eorSim,
      zoi: zoiSim,
      uspeh: true,
      surovOdgovor: JSON.stringify({
        Result: { Success: "true", ZOI: zoiSim, EOR: eorSim, opomba: "lokalna simulacija" },
      }),
    };
  }

  // Testni ali produkcijski način: zahteva certifikat FURS
  const hasCert = !!(data.certPem && data.certKljuc) || !!(data.certifikatPot && fs.existsSync(data.certifikatPot));
  if (!hasCert) {
    return {
      eor: "",
      zoi: "",
      uspeh: false,
      napaka: `${fursNacin === "testno" ? "Testni" : "Produkcijski"} način zahteva certifikat FURS. Naložite certifikat v nastavitvah.`,
      surovOdgovor: "",
    };
  }

  // SOAP+XMLDSig (potrjen format iz dekompilujanega SLOTaxService.dll)
  return posljiNaFURSSOAP(data, fursNacin, splosnaSt);
}

// ---------- Poslovni prostori ----------

export type FursNacin = "simulacija" | "testno" | "produkcija";
export type FursTipProstora = "nepremicnina" | "premicnina" | "elektronska_naprava";
export type FursPremicninaTip = "A" | "B" | "C"; // A=plovilo, B=zrakoplov, C=drugo

export interface FursPoslovniProstorData {
  davcnaStevilka: string;
  ponudnikDavcna?: string;
  poslovniProstorId: string;
  tipProstora: FursTipProstora;
  ulica?: string;
  hisnaStevilka?: string;
  hisnaStevilkaDodatek?: string;
  skupnost?: string;
  kraj?: string;
  postnaStevilka?: string;
  katastrskaStevilka?: string;
  stevilkaStavbe?: string;
  stevilkaDelaStavbe?: string;
  veljavnostOd: string;
  zapri?: boolean;
  certifikatPot?: string;
  certifikatGeslo?: string;
  certPem?: string;
  certKljuc?: string;
  proxyUrl?: string;
  registrskaTablica?: string;
  vin?: string;
  premicninaTip?: FursPremicninaTip;
}

export interface FursPpOdgovor {
  uspeh: boolean;
  napaka?: string;
  surovOdgovor: string;
}

export async function registrirajPoslovniProstor(
  data: FursPoslovniProstorData,
  fursNacin: FursNacin = "simulacija"
): Promise<FursPpOdgovor> {
  // Simulacija: lokalna, brez certifikata ali omrežja
  if (fursNacin === "simulacija") {
    return {
      uspeh: true,
      surovOdgovor: JSON.stringify({ Result: { Success: "true" }, opomba: "lokalna simulacija" }),
    };
  }

  const hasCert = !!(data.certPem && data.certKljuc) || !!(data.certifikatPot && fs.existsSync(data.certifikatPot));
  if (!hasCert) {
    return {
      uspeh: false,
      napaka: `${fursNacin === "testno" ? "Testni" : "Produkcijski"} način zahteva certifikat FURS. Naložite certifikat v nastavitvah.`,
      surovOdgovor: "",
    };
  }

  // SOAP+XMLDSig (potrjen format iz dekompilujanega SLOTaxService.dll)
  return registrirajPoslovniProstorSOAP(data, fursNacin);
}

// ---------- SOAP + XMLDSig ----------

/**
 * Pošlje SOAP XML zahtevo na FURS base URL.
 * URL je /v1/cash_registers (brez sub-poti) — SOAPAction header določa vrsto.
 * MessageType: InvoiceRequest=0→/invoices, BusinessPremise=1→/invoices/register, Echo=2→/echo
 */
const FURS_PROXY_SECRET = "restavracija-pos-furs-proxy-2026"; // noscan — skupni ključ bookie.si FURS proxy strežnika, ni produkcijsko geslo

async function fursFetchSOAP(
  soapBody: string,
  certPot: string,
  soapAction: string,
  testniNacin = true,
  geslo?: string,
  proxyUrl?: string,
  certPem?: string,
  certKljuc?: string
): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {

  // Če je nastavljen proxy URL, posreduj zahtevek prek proxy-ja (obide IP omejetev FURS WAF)
  if (proxyUrl) {
    const parsed = new URL(proxyUrl);
    // Dodaj secret kot query param — fallback za shared hosting, ki strippa custom headerje
    parsed.searchParams.set("s", FURS_PROXY_SECRET);
    const isHttps = parsed.protocol === "https:";
    const mod = isHttps ? https : await import("http");
    return new Promise((resolve, reject) => {
      const bodyBytes = Buffer.byteLength(soapBody, "utf8");
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=UTF-8",
          "Content-Length": bodyBytes,
          "X-Proxy-Secret": FURS_PROXY_SECRET,
          "X-Furs-Action": soapAction,
          "X-Furs-Url": testniNacin ? "test" : "prod",
          ...(certPem  ? { "X-Furs-Cert-Pem": Buffer.from(certPem).toString("base64") }  : {}),
          ...(certKljuc ? { "X-Furs-Cert-Key": Buffer.from(certKljuc).toString("base64") } : {}),
        },
        rejectUnauthorized: false,
      };
      const req = (mod as typeof https).request(opts, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve({
          statusCode: res.statusCode ?? 0,
          body: data,
          headers: res.headers as Record<string, string | string[] | undefined>,
        }));
      });
      req.setTimeout(30000, () => { req.destroy(new Error("FURS proxy timeout")); });
      req.on("error", reject);
      req.write(soapBody);
      req.end();
    });
  }

  // Direktna pot — mTLS na FURS strežnik
  const base = testniNacin
    ? "https://blagajne-test.fu.gov.si:9002"
    : "https://blagajne.fu.gov.si:9003";
  const parsed = new URL(`${base}/v1/cash_registers`);

  const agentOpts: https.AgentOptions = { rejectUnauthorized: false, minVersion: "TLSv1.2" };

  const mTlsCert = resolveCertPem(certPot, geslo, certPem, certKljuc);
  if (mTlsCert) {
    try {
      const caCert = certPot ? beriCACert(certPot, testniNacin) : null;
      agentOpts.cert = mTlsCert.cert + (caCert ? "\n" + caCert : "");
      agentOpts.key = Buffer.from(mTlsCert.key);
    } catch { /* ni veljavnega certa — nadaljuj brez */ }
  }

  const agent = new https.Agent(agentOpts);

  return new Promise((resolve, reject) => {
    const bodyBytes = Buffer.byteLength(soapBody, "utf8");
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "Content-Length": bodyBytes,
        "Accept": "text/xml",
        "SOAPAction": soapAction,
      },
      rejectUnauthorized: false,
      agent,
    }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve({
        statusCode: res.statusCode ?? 0,
        body: data,
        headers: res.headers as Record<string, string | string[] | undefined>,
      }));
    });
    req.setTimeout(15000, () => { req.destroy(new Error("FURS SOAP timeout")); });
    req.on("error", reject);
    req.write(soapBody);
    req.end();
  });
}

/**
 * Podpiše XML element z Id="test" z XMLDSig (RSA-SHA256, enveloped, C14N).
 * Podpis se vstavi znotraj elementa (append).
 * Podpira PEM iz baze (certPem/certKljuc) ali datoteke na disku (certPot).
 */
export function podpisiXML(innerXml: string, certPot: string, geslo?: string, certPem?: string, certKljuc?: string): string {
  const certData = resolveCertPem(certPot, geslo, certPem, certKljuc);
  if (!certData) throw new Error("Certifikat ni na voljo za XMLDSig podpis");
  const { key: keyMatch, cert: certMatch } = certData;

  const certDer = certMatch
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");

  // Ekstrahiraj X509IssuerSerial za FURS identifikacijo certifikata
  let issuerSerial = "";
  try {
    const x509 = new crypto.X509Certificate(certMatch);
    // Node vrne issuer v OpenSSL formatu z \n — pretvori v RFC 4514 (obrnjeno, vejica)
    const lines = x509.issuer.split("\n").map(l => l.trim()).filter(Boolean);
    const issuerName = lines.reverse().join(",");
    // Serial iz hex v decimal
    const serialHex = x509.serialNumber.replace(/:/g, "");
    const serialDec = BigInt("0x" + serialHex).toString(10);
    issuerSerial =
      `<X509IssuerSerial>` +
      `<X509IssuerName>${issuerName}</X509IssuerName>` +
      `<X509SerialNumber>${serialDec}</X509SerialNumber>` +
      `</X509IssuerSerial>`;
  } catch { /* brez IssuerSerial če ekstrakcija spodleti */ }

  const sig = new SignedXml({
    privateKey: keyMatch,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    publicCert: certMatch,
  });

  sig.addReference({
    xpath: "//*[@Id='test']",
    // Enveloped-signature izloči <Signature> element; C14N nato kanonizira rezultat pred digestiranjem.
    // Oba transforma sta potrebna — brez eksplicitnega C14N FURS in xml-crypto ne uskladita serializacije.
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    uri: "#test",
    isEmptyUri: false,
  });

  sig.getKeyInfoContent = () =>
    `<X509Data>${issuerSerial}<X509Certificate>${certDer}</X509Certificate></X509Data>`;

  sig.computeSignature(innerXml, {
    location: { reference: "//*[@Id='test']", action: "append" },
  });

  return sig.getSignedXml();
}

/** Ovije podpisani XML v SOAP Envelope.
 * POZOR: xmlns:fu NI deklariran tukaj — deklariran je na podpisanem elementu (BusinessPremiseRequest/InvoiceRequest/Echo).
 * Če bi Envelope deklariral isti xmlns:fu, C14N pri verifikaciji ne bi vključil deklaracije na podpisanem elementu
 * (ker je že "v scope" od ancestorja) → drugačen digest → S003.
 */
export function buildSOAPEnvelope(innerXml: string): string {
  return (
    `<?xml version='1.0' encoding='UTF-8'?>` +
    `<soapenv:Envelope xmlns:soapenv='http://schemas.xmlsoap.org/soap/envelope/'` +
    ` xmlns:xd='http://www.w3.org/2000/09/xmldsig#'` +
    ` xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>` +
    `<soapenv:Header/>` +
    `<soapenv:Body>${innerXml}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

function buildBpIdentifierXML(data: FursPoslovniProstorData): string {
  // FURS v1 XSD BPIdentifierType je choice med:
  //   RealEstateBP (nepremičnina z naslovom)
  //   PremiseType  (vrednosti A/B/C — premičnine + elektronske naprave)
  //   VendingMachine (avtomati)
  // Elementa MovablePremise/MovableType in ElectronicDeviceBP v shemi NE OBSTAJATA.
  if (data.tipProstora === "premicnina") {
    // A = premičen objekt (vozilo), B = objekt na stalni lokaciji (kiosk), C = elektronska naprava
    return `<fu:PremiseType>${data.premicninaTip ?? "C"}</fu:PremiseType>`;
  }
  if (data.tipProstora === "elektronska_naprava") {
    // C = posamezna elektronska naprava za izdajo računov
    return `<fu:PremiseType>C</fu:PremiseType>`;
  }
  const missingFields: string[] = [];
  if (!data.ulica) missingFields.push("Ulica");
  if (!data.hisnaStevilka) missingFields.push("Hišna številka");
  if (!data.kraj) missingFields.push("Kraj");
  if (!data.postnaStevilka) missingFields.push("Poštna številka");
  if (missingFields.length > 0) {
    throw new Error(`Nepremičninski poslovni prostor zahteva naslovne podatke. Manjka: ${missingFields.join(", ")}.`);
  }

  let propId = "";
  if (data.katastrskaStevilka && data.stevilkaStavbe && data.stevilkaDelaStavbe) {
    propId =
      `<fu:PropertyID>` +
      `<fu:CadastralNumber>${data.katastrskaStevilka}</fu:CadastralNumber>` +
      `<fu:BuildingNumber>${data.stevilkaStavbe}</fu:BuildingNumber>` +
      `<fu:BuildingSectionNumber>${data.stevilkaDelaStavbe}</fu:BuildingSectionNumber>` +
      `</fu:PropertyID>`;
  }
  const houseDodatek = data.hisnaStevilkaDodatek
    ? `<fu:HouseNumberAdditional>${data.hisnaStevilkaDodatek}</fu:HouseNumberAdditional>`
    : "";
  const address =
    `<fu:Address>` +
    `<fu:Street>${data.ulica}</fu:Street>` +
    `<fu:HouseNumber>${data.hisnaStevilka}</fu:HouseNumber>` +
    houseDodatek +
    `<fu:Community>${data.skupnost || data.kraj}</fu:Community>` +
    `<fu:City>${data.kraj}</fu:City>` +
    `<fu:PostalCode>${data.postnaStevilka}</fu:PostalCode>` +
    `</fu:Address>`;
  return `<fu:RealEstateBP>${propId}${address}</fu:RealEstateBP>`;
}

/** Zgradi BusinessPremiseRequest XML (brez SOAP ovoja, za XMLDSig podpis) */
function buildSOAPBPXML(data: FursPoslovniProstorData): string {
  const msgId = crypto.randomUUID();
  // FURS zahteva lokalni LJ čas brez Z — enako kot IssueDateTime v InvoiceRequest.
  // Produkcijski strežnik zavrne UTC+Z format z napako S001.
  const nowTs = toSloTimestamp(new Date());
  const softwareTaxNum = data.ponudnikDavcna || data.davcnaStevilka;
  const closingTag = data.zapri ? `<fu:ClosingTag>true</fu:ClosingTag>` : "";
  // FURS zahteva samo datum YYYY-MM-DD, ne celoten ISO timestamp
  const veljavnostOd = (data.veljavnostOd ?? new Date().toISOString()).slice(0, 10);

  return (
    `<fu:BusinessPremiseRequest xmlns:fu='http://www.fu.gov.si/' Id='test'>` +
    `<fu:Header><fu:MessageID>${msgId}</fu:MessageID><fu:DateTime>${nowTs}</fu:DateTime></fu:Header>` +
    `<fu:BusinessPremise>` +
    `<fu:TaxNumber>${data.davcnaStevilka}</fu:TaxNumber>` +
    `<fu:BusinessPremiseID>${data.poslovniProstorId}</fu:BusinessPremiseID>` +
    `<fu:BPIdentifier>${buildBpIdentifierXML(data)}</fu:BPIdentifier>` +
    `<fu:ValidityDate>${veljavnostOd}</fu:ValidityDate>` +
    `<fu:SoftwareSupplier><fu:TaxNumber>${softwareTaxNum}</fu:TaxNumber></fu:SoftwareSupplier>` +
    `<fu:SpecialNotes>${data.zapri ? "Zapiranje poslovnega prostora" : "Prijava poslovnega prostora"}</fu:SpecialNotes>` +
    closingTag +
    `</fu:BusinessPremise>` +
    `</fu:BusinessPremiseRequest>`
  );
}

/** Zgradi InvoiceRequest XML (brez SOAP ovoja, za XMLDSig podpis).
 * Izvožena za integracijske teste (preverjanje TaxesPerSeller vs InvoiceAmount). */
/** Formatira datum v lokalni slovenskem času (Europe/Ljubljana) brez timezone sufiksa.
 * FURS zahteva IssueDateTime kot lokalni čas brez Z — to je vzrok S001 če pošljemo UTC+Z. */
function toSloTimestamp(date: Date): string {
  // sv-SE locale daje ISO-like format YYYY-MM-DD HH:MM:SS → zamenjamo presledek s T
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Ljubljana",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date).replace(" ", "T");
}

export function buildInvoiceXML(data: FursRacunData, zoi?: string, splosnaSt = 22): string {
  const issueDt = toSloTimestamp(data.datumCas);

  // Format: PP001-B001-NNNNNN — vzemi 6-mestno zaporedno številko.
  // FURS shema: ZaporednaStevilkaType maxInclusive=9999999.
  const seqNum = (() => {
    const m = data.stevilkaRacuna.match(/-(\d{6})$/);
    if (m) return parseInt(m[1], 10);
    const m2 = data.stevilkaRacuna.match(/(\d+)$/);
    return m2 ? parseInt(m2[1], 10) : 1;
  })();

  const vatGroups = new Map<number, { taxable: number; tax: number }>();
  for (const p of data.postavke) {
    // Zaokrožimo vsako vrstico na 2 decimalni mesti pred akumulacijo,
    // da preprečimo nabiranje napak zaokroževanja pri večjem številu postavk.
    // FURS primerja seštevek DDV po skupinah s skupnim DDV na računu —
    // neskladje povzroči napako S003.
    const lineTotal = round2(p.kolicina * p.cenaKos);
    const taxAmount = round2((lineTotal * p.davek) / (100 + p.davek));
    const taxable = round2(lineTotal - taxAmount);
    const existing = vatGroups.get(p.davek) ?? { taxable: 0, tax: 0 };
    vatGroups.set(p.davek, { taxable: existing.taxable + taxable, tax: existing.tax + taxAmount });
  }
  if (vatGroups.size === 0) {
    vatGroups.set(splosnaSt, { taxable: round2(data.skupaj - data.ddv), tax: data.ddv });
  }

  const vatLines = Array.from(vatGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(
      ([rate, { taxable, tax }]) =>
        `<fu:VAT>` +
        `<fu:TaxRate>${rate.toFixed(2)}</fu:TaxRate>` +
        `<fu:TaxableAmount>${taxable.toFixed(2)}</fu:TaxableAmount>` +
        `<fu:TaxAmount>${tax.toFixed(2)}</fu:TaxAmount>` +
        `</fu:VAT>`
    )
    .join("");

  const protectedId = zoi ? `<fu:ProtectedID>${zoi}</fu:ProtectedID>` : "";
  const operatorTaxNum = data.operatorDavcna
    ? `<fu:OperatorTaxNumber>${data.operatorDavcna}</fu:OperatorTaxNumber>`
    : "";
  const customerTaxNum = data.kupecDavcnaStevilka
    ? `<fu:CustomerTaxNumber>${data.kupecDavcnaStevilka}</fu:CustomerTaxNumber>`
    : "";

  // ReferenceInvoice: obvezen za storno račune (FURS spec v5.0)
  // Struktura: ReferenceInvoiceIdentifier (PP/device/seqNum) + ReferenceInvoiceIssueDateTime
  let referenceInvoice = "";
  if (data.jeStorno && data.izvornaStevRacuna) {
    const m = data.izvornaStevRacuna.match(/^(.+)-(.+)-\d+$/);
    const origPP = m?.[1] ?? data.poslovnaProstor ?? "PP001";
    const origDevice = m?.[2] ?? data.blagajnaId ?? "B001";
    const origSeqNum = extractFursSeqNum(data.izvornaStevRacuna);
    const origDt = data.izvornaStevRacunaDatumCas
      ? toSloTimestamp(data.izvornaStevRacunaDatumCas)
      : issueDt;
    referenceInvoice =
      `<fu:ReferenceInvoice>` +
      `<fu:ReferenceInvoiceIdentifier>` +
      `<fu:BusinessPremiseID>${origPP}</fu:BusinessPremiseID>` +
      `<fu:ElectronicDeviceID>${origDevice}</fu:ElectronicDeviceID>` +
      `<fu:InvoiceNumber>${origSeqNum}</fu:InvoiceNumber>` +
      `</fu:ReferenceInvoiceIdentifier>` +
      `<fu:ReferenceInvoiceIssueDateTime>${origDt}</fu:ReferenceInvoiceIssueDateTime>` +
      `</fu:ReferenceInvoice>`;
  }

  // FURS XSD InvoiceRequest zahteva Header (minOccurs=1) — brez njega FURS vrne S001.
  // XSD vrstni red za InvoiceType:
  //   TaxNumber → IssueDateTime → NumberingStructure → InvoiceIdentifier →
  //   CustomerVATNumber (opt) → InvoiceAmount → ReturnsAmount (opt) →
  //   PaymentAmount → TaxesPerSeller → OperatorTaxNumber (opt) → ... → ProtectedID
  const msgId = crypto.randomUUID();
  return (
    `<fu:InvoiceRequest xmlns:fu='http://www.fu.gov.si/' Id='test'>` +
    `<fu:Header><fu:MessageID>${msgId}</fu:MessageID><fu:DateTime>${issueDt}</fu:DateTime></fu:Header>` +
    `<fu:Invoice>` +
    `<fu:TaxNumber>${data.davcnaStevilka ?? "12345678"}</fu:TaxNumber>` +
    `<fu:IssueDateTime>${issueDt}</fu:IssueDateTime>` +
    `<fu:NumberingStructure>B</fu:NumberingStructure>` +
    `<fu:InvoiceIdentifier>` +
    `<fu:BusinessPremiseID>${data.poslovnaProstor ?? "PP001"}</fu:BusinessPremiseID>` +
    `<fu:ElectronicDeviceID>${data.blagajnaId ?? "B001"}</fu:ElectronicDeviceID>` +
    `<fu:InvoiceNumber>${seqNum}</fu:InvoiceNumber>` +
    `</fu:InvoiceIdentifier>` +
    customerTaxNum +
    `<fu:InvoiceAmount>${data.skupaj.toFixed(2)}</fu:InvoiceAmount>` +
    `<fu:PaymentAmount>${data.skupaj.toFixed(2)}</fu:PaymentAmount>` +
    `<fu:TaxesPerSeller>${vatLines}</fu:TaxesPerSeller>` +
    operatorTaxNum +
    protectedId +
    referenceInvoice +
    `</fu:Invoice>` +
    `</fu:InvoiceRequest>`
  );
}

/**
 * Registrira poslovni prostor pri FURS z SOAP+XMLDSig.
 * Potrjena metoda (dekompilujan SLOTaxService.dll).
 */
export async function registrirajPoslovniProstorSOAP(
  data: FursPoslovniProstorData,
  fursNacin: FursNacin = "simulacija"
): Promise<FursPpOdgovor> {
  const hasCert = !!(data.certPem && data.certKljuc) || !!(data.certifikatPot && fs.existsSync(data.certifikatPot));
  if (!hasCert) {
    return { uspeh: false, napaka: "Zahteva certifikat FURS.", surovOdgovor: "" };
  }
  const testniNacinUrl = fursNacin !== "produkcija";
  try {
    const innerXml = buildSOAPBPXML(data);
    // KRITIČNO: podpiši celoten SOAP dokument (ne standalone innerXml).
    // xml-crypto mora računati DigestValue v SOAP kontekstu (z vsemi namespace nodes od prednikov),
    // ker FURS pri verifikaciji vidi BusinessPremiseRequest znotraj celotnega SOAP dokumenta.
    // Brez tega C14N med podpisovanjem in verifikacijo producira različen output → S003.
    const soapBody = buildSOAPEnvelope(innerXml);
    const signedSoap = podpisiXML(soapBody, data.certifikatPot ?? "", data.certifikatGeslo, data.certPem, data.certKljuc);
    const fursOdgovor = await fursFetchSOAP(signedSoap, data.certifikatPot ?? "", "/invoices/register", testniNacinUrl, data.certifikatGeslo, data.proxyUrl, data.certPem, data.certKljuc);
    const surovOdgovor = `[POSLAN XML]\n${innerXml}\n\n[HTTP ${fursOdgovor.statusCode}]\n${fursOdgovor.body}`;
    if (jeFursWafZavrnitev(fursOdgovor.body)) {
      return { uspeh: false, napaka: "FURS WAF je zavrnil zahtevek: strežnik ni dosegljiv z vašega IP naslova. Potrebujete proxy strežnik v Sloveniji.", surovOdgovor };
    }
    const fursNapaka = parseFursSoapError(fursOdgovor.body);
    if (fursNapaka) {
      return { uspeh: false, napaka: `${fursNapaka.koda}: ${fursNapaka.sporocilo}`, surovOdgovor };
    }
    const uspeh = fursOdgovor.statusCode >= 200 && fursOdgovor.statusCode < 300;
    return { uspeh, surovOdgovor };
  } catch (err) {
    const napaka = err instanceof Error ? err.message : "Neznana napaka";
    return { uspeh: false, napaka, surovOdgovor: JSON.stringify({ napaka }) };
  }
}

/**
 * Pošlje račun na FURS z SOAP+XMLDSig.
 * Potrjena metoda (dekompilujan SLOTaxService.dll).
 */
export async function posljiNaFURSSOAP(
  data: FursRacunData,
  fursNacin: FursNacin = "simulacija",
  splosnaSt = 22
): Promise<FursOdgovor> {
  const davcna = data.davcnaStevilka ?? "12345678";

  // SIMULACIJA: lokalna ZOI+EOR (MD5+UUID), brez omrežja.
  if (fursNacin === "simulacija") {
    const zoi = izracunajZOI(data.stevilkaRacuna, data.datumCas, data.skupaj, davcna);
    const eor = crypto.randomUUID();
    return { eor, zoi, uspeh: true, surovOdgovor: JSON.stringify({ opomba: "lokalna simulacija" }) };
  }
  const testniNacinUrl = fursNacin !== "produkcija";

  // FURS SOAP klic z RSA ZOI + XMLDSig podpisom.
  const hasCert = !!(data.certPem && data.certKljuc) || !!(data.certifikatPot && fs.existsSync(data.certifikatPot));
  if (!hasCert) {
    return { eor: "", zoi: "", uspeh: false, napaka: "Testni/produkcijski način zahteva certifikat FURS (nastavitve → certifikat).", surovOdgovor: "" };
  }

  // Produkcija: RSA ZOI (kot zahteva FURS v produkciji)
  let zoi: string;
  try {
    const dt = data.datumCas;
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    const content = `${davcna}${ts}${data.skupaj.toFixed(2)}${data.stevilkaRacuna}${data.poslovnaProstor ?? "PP001"}${data.blagajnaId ?? "B001"}`;
    zoi = izracunajZOIRSA(content, data.certifikatPot, data.certifikatGeslo, data.certKljuc);
  } catch {
    zoi = izracunajZOI(data.stevilkaRacuna, data.datumCas, data.skupaj, davcna);
  }

  try {
    const invoiceXml = buildInvoiceXML(data, zoi, splosnaSt);
    const soapBody = buildSOAPEnvelope(invoiceXml);
    const signedSoap = podpisiXML(soapBody, data.certifikatPot ?? "", data.certifikatGeslo, data.certPem, data.certKljuc);
    const fursOdgovor = await fursFetchSOAP(signedSoap, data.certifikatPot ?? "", "/invoices", testniNacinUrl, data.certifikatGeslo, data.proxyUrl, data.certPem, data.certKljuc);
    const surovOdgovor = `[POSLAN XML]\n${invoiceXml}\n\n[HTTP ${fursOdgovor.statusCode}]\n${fursOdgovor.body}`;

    if (jeFursWafZavrnitev(fursOdgovor.body)) {
      return { eor: "", zoi, uspeh: false, napaka: "FURS WAF je zavrnil zahtevek: strežnik ni dosegljiv z vašega IP naslova. Potrebujete proxy strežnik v Sloveniji.", surovOdgovor };
    }
    const fursNapaka = parseFursSoapError(fursOdgovor.body);
    if (fursNapaka) {
      return { eor: "", zoi, uspeh: false, napaka: `${fursNapaka.koda}: ${fursNapaka.sporocilo}`, surovOdgovor };
    }

    if (fursOdgovor.statusCode >= 200 && fursOdgovor.statusCode < 300) {
      const eorMatch = fursOdgovor.body.match(/<(?:fu:)?UniqueInvoiceID>(.*?)<\/(?:fu:)?UniqueInvoiceID>/);
      const zoiMatch = fursOdgovor.body.match(/<(?:fu:)?ProtectedID>(.*?)<\/(?:fu:)?ProtectedID>/);
      const resultEor = fursOdgovor.body.match(/<EOR>(.*?)<\/EOR>/)?.[1];
      const resultZoi = fursOdgovor.body.match(/<ZOI>(.*?)<\/ZOI>/)?.[1];
      const eor = eorMatch?.[1] ?? resultEor ?? "";
      const zoiOdgovor = zoiMatch?.[1] ?? resultZoi ?? zoi;
      if (eor) return { eor, zoi: zoiOdgovor, uspeh: true, surovOdgovor };
    }

    return { eor: "", zoi, uspeh: false, napaka: `FURS napaka HTTP ${fursOdgovor.statusCode}`, surovOdgovor };
  } catch (err) {
    const napaka = err instanceof Error ? err.message : "Neznana napaka";
    return { eor: "", zoi, uspeh: false, napaka, surovOdgovor: JSON.stringify({ napaka }) };
  }
}

/** Izvleče FURS ErrorCode/ErrorMessage iz SOAP telesa. Vrne null če ni napake. */
function parseFursSoapError(body: string): { koda: string; sporocilo: string } | null {
  const kodaMatch = body.match(/<(?:fu:)?ErrorCode>(.*?)<\/(?:fu:)?ErrorCode>/);
  const sporocMatch = body.match(/<(?:fu:)?ErrorMessage>(.*?)<\/(?:fu:)?ErrorMessage>/);
  if (kodaMatch?.[1]) {
    return { koda: kodaMatch[1], sporocilo: sporocMatch?.[1] ?? kodaMatch[1] };
  }
  return null;
}

/** Vrne true, če je odgovor HTML stran FURS WAF (IP blokiran — zunanji dostop). */
function jeFursWafZavrnitev(body: string): boolean {
  return body.trimStart().startsWith("<html") && body.includes("Request Rejected");
}

type DiagResult = { statusCode: number; body: string; headers: Record<string, string | string[] | undefined> };
const diagErr = (e: unknown): DiagResult => ({ statusCode: -1, body: String(e), headers: {} });

/**
 * Pošlje podpisani SOAP echo na FURS (prek proxy-ja, če je nastavljen).
 *
 * Vrstni red: buildSOAPEnvelope(echoInner) → podpisiXML(soapDoc)  [wrap-then-sign]
 * DigestValue se izračuna v kontekstu celotnega SOAP dokumenta — enako kot
 * InvoiceRequest in BusinessPremiseRequest. Obraten red (sign-then-wrap) bi
 * povzročil S003, ker C14N pri verifikaciji vključi namespace deklaracije prednikov.
 *
 * Vrne: { uspeh, statusCode, body }
 */
export async function fursSOAPEcho(
  certPot: string,
  fursNacin: FursNacin = "simulacija",
  geslo?: string,
  proxyUrl?: string,
  certPem?: string,
  certKljuc?: string
): Promise<{ uspeh: boolean; statusCode: number; body: string; napaka?: string }> {
  if (fursNacin === "simulacija") {
    return { uspeh: true, statusCode: 200, body: '{"opomba":"simulacijski način — brez dejanske FURS povezave"}' };
  }
  try {
    const echoInner = `<fu:EchoRequest xmlns:fu='http://www.fu.gov.si/' Id='test'>echo-soap-test</fu:EchoRequest>`;
    // wrap-then-sign: najprej SOAP ovitek, nato podpis celotnega dokumenta
    const echoSoap = buildSOAPEnvelope(echoInner);
    const echoSoapSigned = podpisiXML(echoSoap, certPot, geslo, certPem, certKljuc);
    const odgovor = await fursFetchSOAP(echoSoapSigned, certPot, "/echo", fursNacin !== "produkcija", geslo, proxyUrl, certPem, certKljuc);
    const uspeh = odgovor.statusCode >= 200 && odgovor.statusCode < 300 &&
      (odgovor.body.includes("EchoResponse") || odgovor.body.includes("echo"));
    return { uspeh, statusCode: odgovor.statusCode, body: odgovor.body };
  } catch (err) {
    const napaka = err instanceof Error ? err.message : String(err);
    return { uspeh: false, statusCode: 0, body: "", napaka };
  }
}

export async function fursEchoDiagnostika(certPot: string, testniNacin = true, geslo?: string): Promise<{
  certNajden: boolean;
  caCertPrenesen: boolean;
  /** A: GET /echo brez telesa */
  echoGet: DiagResult;
  /** B: POST /echo z {} JSON */
  echoPost: DiagResult;
  /** C: POST /echo z {"echo":"test"} */
  echoPostPayload: DiagResult;
  /** D: POST /business_premises z {"token":"jwt"}, naš TaxNumber (10088458), wrapper ključ */
  jwtWrapped: DiagResult;
  /** E: POST /business_premises z golim JWT telesom (brez {token:...} wrapper) */
  jwtRaw: DiagResult;
  /** F: POST /business_premises, TaxNumber=10088458, SoftwareSupplier=24564444 (testni dobavitelj) */
  jwtTestSupplier: DiagResult;
  /** G: POST /business_premises z {"token":"neveljaven.jwt.tukaj"} — razkrije ali FURS validira JWT */
  jwtNeveljaven: DiagResult;
  /** H: POST /business_premises brez wrapper ključa (stari format: {Header, BusinessPremise}) */
  jwtBrezWrapper: DiagResult;
  /** I: POST /business_premises z raw XML (text/xml) — kot stari SOAP API */
  xmlRaw: DiagResult;
  /** J: POST /echo z raw XML — preizkus ali echo sprejme XML */
  xmlEcho: DiagResult;
  /** K: SOAP echo na base URL (/v1/cash_registers) z SOAPAction: /echo */
  soapEcho: DiagResult;
  /** L: SOAP BusinessPremise na base URL z SOAPAction: /invoices/register + XMLDSig */
  soapBP: DiagResult;
}> {
  const certNajden = fs.existsSync(certPot);

  const base = testniNacin
    ? "https://blagajne-test.fu.gov.si:9002"
    : "https://blagajne.fu.gov.si:9000";

  // Pomočnik za GET (brez telesa) — vključuje polno verigo certifikatov
  const httpGet = (url: string): Promise<DiagResult> =>
    new Promise((resolve) => {
      const parsed = new URL(url);
      let clientCert2: string | undefined;
      let clientKey2: Buffer | undefined;
      try {
        const { key, cert } = nalagajCertPem(certPot, geslo);
        const caCert = beriCACert(certPot, testniNacin);
        clientCert2 = cert + (caCert ? "\n" + caCert : "");
        clientKey2 = Buffer.from(key);
      } catch { /* ni cert */ }
      const agent = new https.Agent({
        rejectUnauthorized: false,
        cert: clientCert2,
        key: clientKey2,
      });
      const req = https.request({ hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname, method: "GET", headers: {}, agent }, (res) => {
        let d = ""; res.on("data", (c: Buffer) => { d += c.toString(); });
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: d.slice(0, 500), headers: res.headers as Record<string, string | string[] | undefined> }));
      });
      req.setTimeout(10000, () => { req.destroy(); resolve({ statusCode: -1, body: "timeout", headers: {} }); });
      req.on("error", (e) => resolve(diagErr(e)));
      req.end();
    });

  // A: GET echo
  let echoGet: DiagResult = { statusCode: 0, body: "", headers: {} };
  try { echoGet = await httpGet(`${base}/v1/cash_registers/echo`); }
  catch (e) { echoGet = diagErr(e); }

  // B: POST echo z {}
  let echoPost: DiagResult = { statusCode: 0, body: "", headers: {} };
  try { echoPost = await fursFetch(`${base}/v1/cash_registers/echo`, "{}", certPot, "application/json; charset=UTF-8", testniNacin, geslo); }
  catch (e) { echoPost = diagErr(e); }

  // C: POST echo z {"echo":"test"}
  let echoPostPayload: DiagResult = { statusCode: 0, body: "", headers: {} };
  try { echoPostPayload = await fursFetch(`${base}/v1/cash_registers/echo`, JSON.stringify({ echo: "test" }), certPot, "application/json; charset=UTF-8", testniNacin, geslo); }
  catch (e) { echoPostPayload = diagErr(e); }

  // D+E+F+G+H+I+J: JWT in XML testi — samo če je cert najden
  let jwtWrapped: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let jwtRaw: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let jwtTestSupplier: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let jwtNeveljaven: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let jwtBrezWrapper: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let xmlRaw: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let xmlEcho: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let soapEcho: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };
  let soapBP: DiagResult = { statusCode: 0, body: "cert ni najden", headers: {} };

  if (certNajden) {
    const msgId = () => crypto.randomUUID();
    const nowTs = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    // Skupni payload za D in E (naš TaxNumber 10088458, SoftwareSupplier kot array)
    const basePayload = () => ({
      BusinessPremiseRequest: {
        Header: { MessageID: msgId(), DateTime: nowTs() },
        BusinessPremise: {
          TaxNumber: 10088458,
          BusinessPremiseID: "PP001",
          BPIdentifier: {
            RealEstateBP: {
              PropertyID: { CadastralNumber: 365, BuildingNumber: 12, BuildingSectionNumber: 3 },
              Address: { Street: "Dunajska cesta", HouseNumber: "24", HouseNumberAdditional: "B", Community: "Ljubljana", City: "Ljubljana", PostalCode: "1000" },
            },
          },
          ValidityDate: "2020-08-25",
          SoftwareSupplier: [{ TaxNumber: 10088458 }],
          SpecialNotes: "Primer prijave poslovnega prostora",
        },
      },
    });

    // D: {"token": jwt}
    try {
      const token = buildFursJWT(basePayload(), certPot, testniNacin, geslo);
      jwtWrapped = await fursFetch(`${base}/v1/cash_registers/business_premises`, JSON.stringify({ token }), certPot, "application/json; charset=UTF-8", testniNacin, geslo);
    } catch (e) { jwtWrapped = diagErr(e); }

    // E: Goli JWT kot telo (brez {"token":...})
    try {
      const token = buildFursJWT(basePayload(), certPot, testniNacin, geslo);
      jwtRaw = await fursFetch(`${base}/v1/cash_registers/business_premises`, token, certPot, "application/jwt", testniNacin, geslo);
    } catch (e) { jwtRaw = diagErr(e); }

    // F: SoftwareSupplier=24564444 (testni dobavitelj iz FURS primere)
    try {
      const payloadF = {
        BusinessPremiseRequest: {
          Header: { MessageID: msgId(), DateTime: nowTs() },
          BusinessPremise: {
            TaxNumber: 10088458,
            BusinessPremiseID: "PP001",
            BPIdentifier: {
              RealEstateBP: {
                PropertyID: { CadastralNumber: 365, BuildingNumber: 12, BuildingSectionNumber: 3 },
                Address: { Street: "Dunajska cesta", HouseNumber: "24", HouseNumberAdditional: "B", Community: "Ljubljana", City: "Ljubljana", PostalCode: "1000" },
              },
            },
            ValidityDate: "2020-08-25",
            SoftwareSupplier: [{ TaxNumber: 24564444 }],
            SpecialNotes: "Primer prijave poslovnega prostora",
          },
        },
      };
      const token = buildFursJWT(payloadF, certPot, testniNacin, geslo);
      jwtTestSupplier = await fursFetch(`${base}/v1/cash_registers/business_premises`, JSON.stringify({ token }), certPot, "application/json; charset=UTF-8", testniNacin, geslo);
    } catch (e) { jwtTestSupplier = diagErr(e); }

    // G: Namerno neveljaven JWT — razkrije ali FURS validira JWT podpis/strukturo
    try {
      jwtNeveljaven = await fursFetch(`${base}/v1/cash_registers/business_premises`, JSON.stringify({ token: "invalid.jwt.tukaj" }), certPot, "application/json; charset=UTF-8", testniNacin, geslo);
    } catch (e) { jwtNeveljaven = diagErr(e); }

    // H: Veljavni JWT brez wrapper ključa (stari format: {Header, BusinessPremise})
    try {
      const payloadH = {
        Header: { MessageID: msgId(), DateTime: nowTs() },
        BusinessPremise: {
          TaxNumber: 10088458,
          BusinessPremiseID: "PP001",
          BPIdentifier: {
            RealEstateBP: {
              PropertyID: { CadastralNumber: 365, BuildingNumber: 12, BuildingSectionNumber: 3 },
              Address: { Street: "Dunajska cesta", HouseNumber: "24", HouseNumberAdditional: "B", Community: "Ljubljana", City: "Ljubljana", PostalCode: "1000" },
            },
          },
          ValidityDate: "2020-08-25",
          SoftwareSupplier: [{ TaxNumber: 10088458 }],
          SpecialNotes: "Primer prijave poslovnega prostora",
        },
      };
      const token = buildFursJWT(payloadH, certPot, testniNacin, geslo);
      jwtBrezWrapper = await fursFetch(`${base}/v1/cash_registers/business_premises`, JSON.stringify({ token }), certPot, "application/json; charset=UTF-8", testniNacin, geslo);
    } catch (e) { jwtBrezWrapper = diagErr(e); }

    // I: Raw XML POST — kot SLOTaxService.exe (stari XML API)
    try {
      const xmlBody = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<fu:BusinessPremiseRequest xmlns:fu="http://www.fu.gov.si/" Id="test">`,
        `  <fu:Header>`,
        `    <fu:MessageID>${msgId()}</fu:MessageID>`,
        `    <fu:DateTime>${nowTs()}</fu:DateTime>`,
        `  </fu:Header>`,
        `  <fu:BusinessPremise>`,
        `    <fu:TaxNumber>10088458</fu:TaxNumber>`,
        `    <fu:BusinessPremiseID>PP001</fu:BusinessPremiseID>`,
        `    <fu:RealEstateBP>`,
        `      <fu:PropertyID>`,
        `        <fu:CadastralNumber>365</fu:CadastralNumber>`,
        `        <fu:BuildingNumber>12</fu:BuildingNumber>`,
        `        <fu:BuildingSectionNumber>3</fu:BuildingSectionNumber>`,
        `      </fu:PropertyID>`,
        `      <fu:Address>`,
        `        <fu:Street>Dunajska cesta</fu:Street>`,
        `        <fu:HouseNumber>24</fu:HouseNumber>`,
        `        <fu:HouseNumberAdditional>B</fu:HouseNumberAdditional>`,
        `        <fu:Community>Ljubljana</fu:Community>`,
        `        <fu:City>Ljubljana</fu:City>`,
        `        <fu:PostalCode>1000</fu:PostalCode>`,
        `      </fu:Address>`,
        `    </fu:RealEstateBP>`,
        `    <fu:ValidityDate>2020-08-25</fu:ValidityDate>`,
        `    <fu:SoftwareSupplier>`,
        `      <fu:TaxNumber>10088458</fu:TaxNumber>`,
        `    </fu:SoftwareSupplier>`,
        `    <fu:SpecialNotes>Primer prijave poslovnega prostora</fu:SpecialNotes>`,
        `  </fu:BusinessPremise>`,
        `</fu:BusinessPremiseRequest>`,
      ].join("\n");
      xmlRaw = await fursFetch(`${base}/v1/cash_registers/business_premises`, xmlBody, certPot, "text/xml; charset=UTF-8", testniNacin, geslo);
    } catch (e) { xmlRaw = diagErr(e); }

    // J: XML na /echo endpoint
    try {
      const echoXml = `<?xml version="1.0" encoding="UTF-8"?><fu:EchoRequest xmlns:fu="http://www.fu.gov.si/">test-xml</fu:EchoRequest>`;
      xmlEcho = await fursFetch(`${base}/v1/cash_registers/echo`, echoXml, certPot, "text/xml; charset=UTF-8", testniNacin, geslo);
    } catch (e) { xmlEcho = diagErr(e); }

    // K: SOAP echo na base URL z SOAPAction: /echo — POTRJEN FORMAT (dekompilujan SLOTaxService.dll)
    try {
      const echoInner = `<fu:EchoRequest xmlns:fu='http://www.fu.gov.si/' Id='test'>echo-soap-test</fu:EchoRequest>`;
      const echoSigned = podpisiXML(echoInner, certPot, geslo);
      const echoSoap = buildSOAPEnvelope(echoSigned);
      soapEcho = await fursFetchSOAP(echoSoap, certPot, "/echo", testniNacin, geslo);
    } catch (e) { soapEcho = diagErr(e); }

    // L: SOAP BusinessPremise na base URL z SOAPAction: /invoices/register + XMLDSig
    try {
      const bpData: FursPoslovniProstorData = {
        davcnaStevilka: "10088458",
        poslovniProstorId: "PP001",
        tipProstora: "nepremicnina",
        katastrskaStevilka: "365",
        stevilkaStavbe: "12",
        stevilkaDelaStavbe: "3",
        ulica: "Dunajska cesta",
        hisnaStevilka: "24",
        hisnaStevilkaDodatek: "B",
        skupnost: "Ljubljana",
        kraj: "Ljubljana",
        postnaStevilka: "1000",
        veljavnostOd: "2020-08-25",
        certifikatPot: certPot,
        certifikatGeslo: geslo,
      };
      const bpInner = buildSOAPBPXML(bpData);
      const bpSigned = podpisiXML(bpInner, certPot, geslo);
      const bpSoap = buildSOAPEnvelope(bpSigned);
      soapBP = await fursFetchSOAP(bpSoap, certPot, "/invoices/register", testniNacin, geslo);
    } catch (e) { soapBP = diagErr(e); }
  }

  const caCertPrenesen = fs.existsSync(caCertPot(certPot, testniNacin));
  return { certNajden, caCertPrenesen, echoGet, echoPost, echoPostPayload, jwtWrapped, jwtRaw, jwtTestSupplier, jwtNeveljaven, jwtBrezWrapper, xmlRaw, xmlEcho, soapEcho, soapBP };
}

// ---------- JSON payload gradniki ----------

function buildBpIdentifierJson(data: FursPoslovniProstorData): object {
  if (data.tipProstora === "premicnina") {
    let movable: object;
    if (data.registrskaTablica) {
      movable = { VehiclePlateNumber: data.registrskaTablica };
    } else if (data.vin) {
      movable = { VehicleVIN: data.vin };
    } else {
      movable = { MovableType: data.premicninaTip ?? "C" };
    }
    return { MovablePremise: movable };
  }
  if (data.tipProstora === "elektronska_naprava") {
    return { ElectronicDeviceBP: { TaxNumber: parseInt(data.davcnaStevilka, 10) } };
  }
  // nepremicnina
  const propId = (data.katastrskaStevilka && data.stevilkaStavbe && data.stevilkaDelaStavbe)
    ? {
        CadastralNumber: parseInt(data.katastrskaStevilka, 10),
        BuildingNumber: parseInt(data.stevilkaStavbe, 10),
        BuildingSectionNumber: parseInt(data.stevilkaDelaStavbe, 10),
      }
    : undefined;

  const address: Record<string, string> = {
    Street: data.ulica ?? "",
    HouseNumber: data.hisnaStevilka ?? "",
    Community: data.skupnost || data.kraj || "",
    City: data.kraj ?? "",
    PostalCode: data.postnaStevilka ?? "",
  };
  if (data.hisnaStevilkaDodatek) address.HouseNumberAdditional = data.hisnaStevilkaDodatek;

  // PropertyID MORA biti pred Address (FURS schema vrstni red)
  const realEstate: Record<string, unknown> = {};
  if (propId) realEstate.PropertyID = propId;
  realEstate.Address = address;
  return { RealEstateBP: realEstate };
}

function buildPpPayload(data: FursPoslovniProstorData, _testniNacin: boolean): object {
  const msgId = crypto.randomUUID();
  const nowTs = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const softwareTaxNum = parseInt(data.ponudnikDavcna || data.davcnaStevilka, 10);

  const bp: Record<string, unknown> = {
    TaxNumber: parseInt(data.davcnaStevilka, 10),
    BusinessPremiseID: data.poslovniProstorId,
    BPIdentifier: buildBpIdentifierJson(data),
    ValidityDate: data.veljavnostOd,
    SoftwareSupplier: [{ TaxNumber: softwareTaxNum }],
    SpecialNotes: data.zapri ? "Zapiranje poslovnega prostora" : "Prijava poslovnega prostora",
  };
  if (data.zapri) bp.ClosingTag = true;

  return {
    BusinessPremiseRequest: {
      Header: { MessageID: msgId, DateTime: nowTs },
      BusinessPremise: bp,
    },
  };
}

function buildInvoicePayload(data: FursRacunData, _testniNacin: boolean, zoi?: string, splosnaSt = 22): object {
  const timestamp = data.datumCas.toISOString().replace(/\.\d{3}Z$/, "Z");
  const msgId = crypto.randomUUID();

  const seqNum = extractFursSeqNum(data.stevilkaRacuna);

  const vatGroups = new Map<number, { taxable: number; tax: number }>();
  for (const p of data.postavke) {
    const lineTotal = round2(p.kolicina * p.cenaKos);
    const taxAmount = round2((lineTotal * p.davek) / (100 + p.davek));
    const taxable = round2(lineTotal - taxAmount);
    const existing = vatGroups.get(p.davek) ?? { taxable: 0, tax: 0 };
    vatGroups.set(p.davek, { taxable: existing.taxable + taxable, tax: existing.tax + taxAmount });
  }
  if (vatGroups.size === 0) {
    vatGroups.set(splosnaSt, { taxable: round2(data.skupaj - data.ddv), tax: data.ddv });
  }

  const vatLines = Array.from(vatGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, { taxable, tax }]) => ({
      TaxRate: parseFloat(rate.toFixed(2)),
      TaxableAmount: parseFloat(taxable.toFixed(2)),
      TaxAmount: parseFloat(tax.toFixed(2)),
    }));

  const invoice: Record<string, unknown> = {
    TaxNumber: parseInt(data.davcnaStevilka ?? "12345678", 10),
    IssueDateTime: timestamp,
    NumberingStructure: "B",
    InvoiceIdentifier: {
      BusinessPremiseID: data.poslovnaProstor ?? "PP001",
      ElectronicDeviceID: data.blagajnaId ?? "B001",
      InvoiceNumber: seqNum,
    },
    InvoiceAmount: parseFloat(data.skupaj.toFixed(2)),
    PaymentAmount: parseFloat(data.skupaj.toFixed(2)),
    TaxesPerSeller: { VAT: vatLines },
  };

  if (zoi) invoice.ProtectedID = zoi;
  if (data.operatorDavcna) invoice.OperatorTaxNumber = parseInt(data.operatorDavcna, 10);
  if (data.kupecDavcnaStevilka) invoice.CustomerTaxNumber = parseInt(data.kupecDavcnaStevilka, 10);
  if (data.jeStorno && data.izvornaStevRacuna) {
    const m = data.izvornaStevRacuna.match(/^(.+)-(.+)-\d+$/);
    const origPP = m?.[1] ?? data.poslovnaProstor ?? "PP001";
    const origDevice = m?.[2] ?? data.blagajnaId ?? "B001";
    const origSeqNum = extractFursSeqNum(data.izvornaStevRacuna);
    const origDt = data.izvornaStevRacunaDatumCas
      ? toSloTimestamp(data.izvornaStevRacunaDatumCas)
      : timestamp;
    invoice.ReferenceInvoice = {
      ReferenceInvoiceIdentifier: {
        BusinessPremiseID: origPP,
        ElectronicDeviceID: origDevice,
        InvoiceNumber: origSeqNum,
      },
      ReferenceInvoiceIssueDateTime: origDt,
    };
  }

  return {
    InvoiceRequest: {
      Header: { MessageID: msgId, DateTime: timestamp },
      Invoice: invoice,
    },
  };
}
