// @ts-nocheck
import crypto from "crypto";
import https from "https";
import { spawnSync } from "child_process";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { eq } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import { desifrirajBizboxGeslo } from "./kripto-bizbox";

// Workspace pins xmldom 0.9, which (unlike 0.8 used by xml-crypto) requires
// an explicit MIME type. xml-crypto calls this API with one argument.
const xmldomParse = DOMParser.prototype.parseFromString;
if (!(DOMParser.prototype.parseFromString as any).__bookieXmlCryptoCompat) {
  const compatibleParse = function(this: DOMParser, source: string, mimeType?: string) {
    return xmldomParse.call(this, source, mimeType ?? "application/xml");
  };
  (compatibleParse as any).__bookieXmlCryptoCompat = true;
  DOMParser.prototype.parseFromString = compatibleParse as typeof DOMParser.prototype.parseFromString;
}

// ---------- P12/PEM certifikat nalagalnik ----------

interface CertPem { key: string; cert: string }

export interface CompanyFursCert {
  certPem: string;
  certKljuc: string;
}

export function fursSigningContextFingerprint(
  fursNacin: "simulacija" | "testno" | "produkcija",
  certPem?: string,
): string {
  if (fursNacin === "simulacija") return "simulation";
  if (!certPem) return "missing-certificate";
  return `sha256:${crypto.createHash("sha256").update(certPem.replace(/\r\n/g, "\n").trim()).digest("hex")}`;
}

/**
 * Prebere izključno certifikat zahtevanega podjetja. Zasebni ključ obstaja
 * samo v lokalnem rezultatu tega klica; nikoli se ne zapisuje ali logira.
 */
export async function pridobiCompanyCert(companyId: string): Promise<CompanyFursCert | null> {
  const [company] = await db
    .select({
      fursCertifikatPem: companiesTable.fursCertifikatPem,
      fursKljucEnc: companiesTable.fursKljucEnc,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);

  if (!company?.fursCertifikatPem || !company.fursKljucEnc) {
    return null;
  }

  try {
    return {
      certPem: company.fursCertifikatPem,
      certKljuc: desifrirajBizboxGeslo(company.fursKljucEnc),
    };
  } catch {
    // Ne preklopi tiho na legacy certifikat, če obstaja pokvarjen company zapis.
    // Pomembno: napaka namerno ne vsebuje nobenega dela šifropisa ali ključa.
    throw new Error("FURS certifikata podjetja ni mogoče dešifrirati.");
  }
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

/** Razreši izključno PEM certifikat in ključ, ki sta bila varno naložena za podjetje. */
function resolveCertPem(certPem?: string, certKljuc?: string): CertPem | null {
  if (certPem && certKljuc) {
    try { return nalagajCertPemIzNiza(certPem, certKljuc); } catch { return null; }
  }
  return null;
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
  certPem?: string;
  certKljuc?: string;
  proxyUrl?: string;
}

/**
 * Iz nespremenljivega payloada izvornega računa izdela storno payload.
 * Cene in davčne stopnje se nikoli ne rekonstruirajo: obrnejo se samo
 * predznačeni zneski/količine, vsi drugi davčni in poslovni podatki ostanejo.
 */
export function zgradiStornoPayloadIzSnapshota<T extends {
  stevilkaRacuna: string;
  datumCas: string;
  skupaj: number;
  ddv: number;
  postavke: Array<{
    ime: string;
    kolicina: number;
    cenaKos: number;
    davek: number;
    skupaj?: number;
  }>;
}>(original: T, novaStevilka: string, novDatumCas: string): T & {
  jeStorno: true;
  izvornaStevRacuna: string;
  izvornaStevRacunaDatumCas: string;
} {
  return {
    ...original,
    stevilkaRacuna: novaStevilka,
    datumCas: novDatumCas,
    skupaj: round2(-original.skupaj),
    ddv: round2(-original.ddv),
    postavke: original.postavke.map((postavka) => ({
      ...postavka,
      kolicina: -postavka.kolicina,
      ...(postavka.skupaj === undefined ? {} : { skupaj: round2(-postavka.skupaj) }),
    })),
    jeStorno: true,
    izvornaStevRacuna: original.stevilkaRacuna,
    izvornaStevRacunaDatumCas: original.datumCas,
  };
}

export interface FursOdgovor {
  eor: string;
  zoi: string;
  uspeh: boolean;
  napaka?: string;
  surovOdgovor: string;
  /** True only when delivery to FURS cannot be proven either way. */
  deliveryUnknown?: boolean;
}

export type FursDeliveryOutcome = "confirmed" | "failed" | "unknown";

export interface CanonicalFursInvoiceFields {
  readonly messageId: string;
  readonly invoiceRequestId: string;
  readonly taxNumber: string;
  readonly issueDateTime: string;
  readonly invoiceNumber: number;
  readonly businessPremiseId: string;
  readonly electronicDeviceId: string;
  readonly invoiceAmount: string;
  readonly paymentAmount: string;
  readonly numberingStructure: "B";
  readonly customerTaxNumber?: string;
  readonly operatorTaxNumber?: string;
  readonly taxesPerSeller: readonly Readonly<{
    taxRate: string;
    taxableAmount: string;
    taxAmount: string;
  }>[];
  readonly referenceInvoice?: Readonly<{
    businessPremiseId: string;
    electronicDeviceId: string;
    invoiceNumber: number;
    issueDateTime: string;
  }>;
  readonly zoiInput: string;
  readonly zoi: string;
  readonly certificateFingerprint: string;
}

/**
 * A durable FURS request. `signedXml` is the exact UTF-8 SOAP document whose
 * hash is in `payloadHash`; transport must never rebuild or re-sign it.
 */
export interface SignedFursInvoiceRequest {
  readonly signedXml: string;
  readonly signedXmlBytes: Buffer;
  readonly invoiceXml: string;
  readonly zoi: string;
  readonly certificateFingerprint: string;
  readonly canonicalFields: Readonly<CanonicalFursInvoiceFields>;
  readonly payloadHash: string;
}

/**
 * Immutable evidence received from a device.  It intentionally has no SOAP
 * MessageID, InvoiceRequest Id, transmission timestamp, XMLDSig, or XML
 * bytes: those belong to one server-side transport attempt only.
 */
export interface LegalInvoiceCore {
  readonly envelopeVersion: "furs-v2";
  readonly operationId: string;
  readonly localReceiptId: string;
  readonly authorityBundle: unknown;
  readonly finalizationPlan: unknown;
  readonly finalizationPlanSha256: string;
  readonly legalInvoice: Readonly<Omit<CanonicalFursInvoiceFields, "messageId" | "invoiceRequestId">>;
  readonly zoiSignatureBase64: string;
  readonly certificateFingerprint: string;
  readonly deviceKeyFingerprintSha256: string;
  readonly deviceSignatureBase64: string;
}

export interface BuildLegalCoreInput {
  readonly operationId: string;
  readonly localReceiptId: string;
  readonly authorityBundle: unknown;
  readonly finalizationPlan: unknown;
  readonly finalizationPlanSha256: string;
  readonly data: FursRacunData;
  /** SPKI DER SHA-256, without the sha256: prefix. */
  readonly deviceKeyFingerprintSha256: string;
  /** Device private key signs the core's canonical JSON excluding this signature. */
  readonly devicePrivateKey: string;
}

export interface FursTransportAttempt {
  readonly attemptNo: number;
  readonly messageId: string;
  readonly invoiceRequestId: string;
  readonly transmissionTime: string;
  readonly signedXml: string;
  readonly signedXmlBytes: Buffer;
  readonly signedXmlSha256: string;
  readonly xmlDsigSignatureBase64: string;
}

function fursV2CanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(fursV2CanonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${fursV2CanonicalJson(child)}`).join(",")}}`;
}

function fursV2UuidV5(operationId: string, name: string): string {
  const namespace = operationId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(namespace)) throw new Error("operationId must be a UUID.");
  const hash = crypto.createHash("sha1").update(Buffer.concat([Buffer.from(namespace, "hex"), Buffer.from(name)])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Build immutable FURS v2 legal evidence and sign it with the device key. */
export function buildLegalCore(input: BuildLegalCoreInput): LegalInvoiceCore {
  if (!input.data.certPem || !input.data.certKljuc) throw new Error("FURS certificate and key are required for LegalInvoiceCore.");
  const provisional = zgradiInPodpisiFursRacun(input.data, 22,
    fursV2UuidV5(input.operationId, "furs-v2:provisional"), "provisional");
  const { messageId: _messageId, invoiceRequestId: _invoiceRequestId, ...legalInvoice } = provisional.canonicalFields;
  const zoiSignature = crypto.createSign("RSA-SHA256");
  zoiSignature.update(legalInvoice.zoiInput, "utf8"); zoiSignature.end();
  const unsigned = {
    envelopeVersion: "furs-v2" as const, operationId: input.operationId, localReceiptId: input.localReceiptId,
    authorityBundle: input.authorityBundle, finalizationPlan: input.finalizationPlan,
    finalizationPlanSha256: input.finalizationPlanSha256, legalInvoice,
    zoiSignatureBase64: zoiSignature.sign(input.data.certKljuc).toString("base64"),
    certificateFingerprint: provisional.certificateFingerprint,
    deviceKeyFingerprintSha256: input.deviceKeyFingerprintSha256,
  };
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(fursV2CanonicalJson(unsigned), "utf8"); signer.end();
  return Object.freeze({ ...unsigned, deviceSignatureBase64: signer.sign(input.devicePrivateKey).toString("base64") });
}

/** Verify the exact FURS ZOI input/signature/certificate fingerprint in immutable core evidence. */
export function legalInvoiceZoiInput(
  legal: Pick<CanonicalFursInvoiceFields, "taxNumber" | "issueDateTime" | "invoiceNumber" | "businessPremiseId" | "electronicDeviceId" | "invoiceAmount">,
): string {
  const match = legal.issueDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Legal invoice IssueDateTime must be Slovenian local YYYY-MM-DDTHH:mm:ss.");
  const [, year, month, day, hour, minute, second] = match;
  if (!/^\d{8}$/.test(legal.taxNumber) || !Number.isInteger(legal.invoiceNumber) || legal.invoiceNumber < 1 ||
      !/^-?\d+\.\d{2}$/.test(legal.invoiceAmount)) {
    throw new Error("Legal invoice fields cannot form an official ZOI input.");
  }
  const legalNumber = `${legal.businessPremiseId}-${legal.electronicDeviceId}-${legal.invoiceNumber}`;
  return `${legal.taxNumber}${day}.${month}.${year} ${hour}:${minute}:${second}${legal.invoiceAmount}${legalNumber}${legal.businessPremiseId}${legal.electronicDeviceId}`;
}

export function verifyZOI(core: Pick<LegalInvoiceCore, "legalInvoice" | "zoiSignatureBase64" | "certificateFingerprint">, publicKeyPem: string, certificateFingerprintExpected?: string): boolean {
  if (certificateFingerprintExpected && core.certificateFingerprint !== certificateFingerprintExpected) return false;
  let expectedInput: string;
  try {
    expectedInput = legalInvoiceZoiInput(core.legalInvoice);
  } catch {
    return false;
  }
  if (Buffer.from(core.legalInvoice.zoiInput, "utf8").compare(Buffer.from(expectedInput, "utf8")) !== 0) return false;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(expectedInput, "utf8"); verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(core.zoiSignatureBase64, "base64"))
    && crypto.createHash("md5").update(Buffer.from(core.zoiSignatureBase64, "base64")).digest("hex") === core.legalInvoice.zoi;
}

/**
 * Builds a fresh signed SOAP attempt. Each positive attempt number produces a
 * unique MessageID and request Id; callers must persist its bytes before I/O.
 */
export function buildSignedTransportAttempt(core: LegalInvoiceCore, data: FursRacunData, attemptNo: number, transmissionTime: Date | string): FursTransportAttempt {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) throw new Error("attemptNo must be a positive integer.");
  const messageId = fursV2UuidV5(core.operationId, `furs-v2:invoice-message:${attemptNo}`);
  const invoiceRequestId = `InvoiceRequest-${core.localReceiptId.replace(/-/g, "")}-${core.operationId.replace(/-/g, "")}-A${attemptNo}`;
  const transmissionDate = new Date(transmissionTime);
  if (Number.isNaN(transmissionDate.valueOf())) throw new Error("transmissionTime must be a valid date.");
  if (!data.certPem || !data.certKljuc) throw new Error("FURS certificate and key are required for a transport attempt.");
  const invoiceXml = buildInvoiceXML(data, core.legalInvoice.zoi, 22, messageId, invoiceRequestId)
    .replace(/(<fu:Header><fu:MessageID>[^<]+<\/fu:MessageID><fu:DateTime>)[^<]+/,
      `$1${toSloTimestamp(transmissionDate)}`);
  const signedXml = podpisiXML(buildSOAPEnvelope(invoiceXml), data.certPem, data.certKljuc);
  const signedXmlBytes = Buffer.from(signedXml, "utf8");
  if (certificateFingerprint(data.certPem) !== core.certificateFingerprint) {
    throw new Error("Transport attempt does not match immutable legal core.");
  }
  const signature = signedXml.match(/<Signature[^>]*>[\s\S]*?<SignatureValue>([^<]+)<\/SignatureValue>[\s\S]*?<\/Signature>/)?.[1];
  if (!signature) throw new Error("Generated XMLDSig is missing.");
  return Object.freeze({
    attemptNo, messageId, invoiceRequestId, transmissionTime: transmissionDate.toISOString(),
    signedXml, signedXmlBytes,
    signedXmlSha256: `sha256:${crypto.createHash("sha256").update(signedXmlBytes).digest("hex")}`, xmlDsigSignatureBase64: signature,
  });
}

export interface FursSignedTransportOptions {
  fursNacin: Exclude<FursNacin, "simulacija">;
  proxyUrl?: string;
  certPem: string;
  certKljuc: string;
}

export interface FursSignedTransportResult extends FursOdgovor {
  outcome: FursDeliveryOutcome;
  payloadHash: string;
}

export type FursSoapTransport = (
  soapBody: string | Buffer,
  soapAction: string,
  testniNacin: boolean,
  proxyUrl?: string,
  certPem?: string,
  certKljuc?: string,
) => Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }>;

export function classifyFursDeliveryOutcome(response: Pick<FursOdgovor, "uspeh" | "eor" | "deliveryUnknown">): FursDeliveryOutcome {
  if (response.uspeh && typeof response.eor === "string" && response.eor.trim()) return "confirmed";
  return response.deliveryUnknown ? "unknown" : "failed";
}

/** The sole lifecycle state eligible for automatic retry claims. */
export function isFursBatchRetryable(state: string): boolean {
  return state === "failed";
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
  certKljucPem?: string
): string {
  try {
    if (!certKljucPem) {
      throw new Error("FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.");
    }
    const privateKey = crypto.createPrivateKey({ key: certKljucPem });
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
): string {
  if (fursNacin === "simulacija") {
    return izracunajZOI(stevilkaRacuna, datumCas, skupaj, davcnaStevilka);
  }
  if (!certKljuc) {
    return izracunajZOI(stevilkaRacuna, datumCas, skupaj, davcnaStevilka);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const dt = datumCas;
  const ts = `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  const content = `${davcnaStevilka}${ts}${skupaj.toFixed(2)}${stevilkaRacuna}${poslovniProstor}${blagajnaId}`;
  try {
    return izracunajZOIRSA(content, certKljuc);
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
  if (!data.certPem || !data.certKljuc) {
    return {
      eor: "",
      zoi: "",
      uspeh: false,
      napaka: "FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.",
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

  if (!data.certPem || !data.certKljuc) {
    return {
      uspeh: false,
      napaka: "FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.",
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
export function sanitizeFursTransportError(error: unknown): string {
  let message = error instanceof Error ? error.message : "FURS transportna napaka";
  const proxySecret = process.env.FURS_PROXY_SECRET;
  if (proxySecret) message = message.split(proxySecret).join("[REDACTED]");
  message = message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED]")
    .slice(0, 500);
  return message || "FURS transportna napaka";
}

class FursProxyConfigurationError extends Error {}

async function fursFetchSOAP(
  soapBody: string | Buffer,
  soapAction: string,
  testniNacin = true,
  proxyUrl?: string,
  certPem?: string,
  certKljuc?: string
): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {

  // Če je nastavljen proxy URL, posreduj zahtevek prek proxy-ja (obide IP omejetev FURS WAF)
  if (proxyUrl) {
    const proxySecret = process.env.FURS_PROXY_SECRET?.trim();
    if (!proxySecret) throw new FursProxyConfigurationError("FURS proxy ni konfiguriran: manjka FURS_PROXY_SECRET.");
    const parsed = new URL(proxyUrl);
    if (parsed.protocol !== "https:") throw new FursProxyConfigurationError("FURS proxy mora uporabljati preverjeno HTTPS povezavo.");
    return new Promise((resolve, reject) => {
      const bodyBytes = Buffer.isBuffer(soapBody) ? soapBody.length : Buffer.byteLength(soapBody, "utf8");
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=UTF-8",
          "Content-Length": bodyBytes,
          "X-Proxy-Secret": proxySecret,
          "X-Furs-Action": soapAction,
          "X-Furs-Url": testniNacin ? "test" : "prod",
          ...(certPem  ? { "X-Furs-Cert-Pem": Buffer.from(certPem).toString("base64") }  : {}),
          ...(certKljuc ? { "X-Furs-Cert-Key": Buffer.from(certKljuc).toString("base64") } : {}),
        },
        rejectUnauthorized: true,
      };
      const req = https.request(opts, (res) => {
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

  const agentOpts: https.AgentOptions = { rejectUnauthorized: true, minVersion: "TLSv1.2" };

  const mTlsCert = resolveCertPem(certPem, certKljuc);
  if (mTlsCert) {
    try {
      agentOpts.cert = mTlsCert.cert;
      agentOpts.key = Buffer.from(mTlsCert.key);
    } catch { /* ni veljavnega certa — nadaljuj brez */ }
  }

  const agent = new https.Agent(agentOpts);

  return new Promise((resolve, reject) => {
    const bodyBytes = Buffer.isBuffer(soapBody) ? soapBody.length : Buffer.byteLength(soapBody, "utf8");
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
      rejectUnauthorized: true,
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
 * Uporablja izključno PEM certifikat in ključ podjetja iz šifrirane baze.
 */
export function podpisiXML(innerXml: string, certPem?: string, certKljuc?: string): string {
  const certData = resolveCertPem(certPem, certKljuc);
  if (!certData) throw new Error("FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.");
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

  const requestId = innerXml.match(/<fu:(?:InvoiceRequest|BusinessPremiseRequest|Echo)\b[^>]*\bId=['"]([A-Za-z_][A-Za-z0-9_.-]*)['"]/)?.[1] ?? "test";
  const requestXPath = `//*[@Id='${requestId}']`;
  const sig = new SignedXml({
    privateKey: keyMatch,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    publicCert: certMatch,
  });

  sig.addReference({
    xpath: requestXPath,
    // Enveloped-signature izloči <Signature> element; C14N nato kanonizira rezultat pred digestiranjem.
    // Oba transforma sta potrebna — brez eksplicitnega C14N FURS in xml-crypto ne uskladita serializacije.
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    uri: `#${requestId}`,
    isEmptyUri: false,
  });

  sig.getKeyInfoContent = () =>
    `<X509Data>${issuerSerial}<X509Certificate>${certDer}</X509Certificate></X509Data>`;

  sig.computeSignature(innerXml, {
    location: { reference: requestXPath, action: "append" },
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
export function toSloTimestamp(date: Date): string {
  // sv-SE locale daje ISO-like format YYYY-MM-DD HH:MM:SS → zamenjamo presledek s T
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Ljubljana",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date).replace(" ", "T");
}

function toSloZoiTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}.${value("month")}.${value("year")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

export function buildInvoiceXML(data: FursRacunData, zoi?: string, splosnaSt = 22, messageId = crypto.randomUUID(), invoiceRequestId = "test"): string {
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
  return (
    `<fu:InvoiceRequest xmlns:fu='http://www.fu.gov.si/' Id='${invoiceRequestId}'>` +
    `<fu:Header><fu:MessageID>${messageId}</fu:MessageID><fu:DateTime>${issueDt}</fu:DateTime></fu:Header>` +
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

function certificateFingerprint(certPem: string): string {
  try {
    return `sha256:${new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, "").toLowerCase()}`;
  } catch {
    return fursSigningContextFingerprint("produkcija", certPem);
  }
}

/** Deep-freezes the small canonical metadata object returned to persistence callers. */
function immutableCanonicalFields(fields: CanonicalFursInvoiceFields): Readonly<CanonicalFursInvoiceFields> {
  const taxesPerSeller = Object.freeze(fields.taxesPerSeller.map((tax) => Object.freeze({ ...tax })));
  const referenceInvoice = fields.referenceInvoice
    ? Object.freeze({ ...fields.referenceInvoice })
    : undefined;
  return Object.freeze({ ...fields, taxesPerSeller, referenceInvoice });
}

/**
 * @deprecated FURS v1 request evidence is quarantine-only. New code must use
 * buildLegalCore followed by buildSignedTransportAttempt for each send.
 *
 * Canonically constructs and signs an invoice without performing any I/O.
 * Supplying `messageId` makes the complete request deterministic (useful when
 * restoring a request from durable offline state); online submission generates
 * it once and then transports the returned bytes unchanged.
 */
export function zgradiInPodpisiFursRacun(
  data: FursRacunData,
  splosnaSt = 22,
  messageId = crypto.randomUUID(),
  invoiceRequestId = "test",
): SignedFursInvoiceRequest {
  if (!data.certPem || !data.certKljuc) {
    throw new Error("FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.");
  }

  const taxNumber = data.davcnaStevilka ?? "12345678";
  const businessPremiseId = data.poslovnaProstor ?? "PP001";
  const electronicDeviceId = data.blagajnaId ?? "B001";
  const zoiInput = `${taxNumber}${toSloZoiTimestamp(data.datumCas)}${data.skupaj.toFixed(2)}${data.stevilkaRacuna}${businessPremiseId}${electronicDeviceId}`;
  let zoi: string;
  try {
    zoi = izracunajZOIRSA(zoiInput, data.certKljuc);
  } catch {
    // Preserve the existing online fallback semantics.
    zoi = izracunajZOI(data.stevilkaRacuna, data.datumCas, data.skupaj, taxNumber);
  }

  const invoiceXml = buildInvoiceXML(data, zoi, splosnaSt, messageId, invoiceRequestId);
  const signedXml = podpisiXML(buildSOAPEnvelope(invoiceXml), data.certPem, data.certKljuc);
  const signedXmlBytes = Buffer.from(signedXml, "utf8");
  const certFingerprint = certificateFingerprint(data.certPem);
  const vatGroups = new Map<number, { taxable: number; tax: number }>();
  for (const item of data.postavke) {
    const lineTotal = round2(item.kolicina * item.cenaKos);
    const tax = round2((lineTotal * item.davek) / (100 + item.davek));
    const taxable = round2(lineTotal - tax);
    const current = vatGroups.get(item.davek) ?? { taxable: 0, tax: 0 };
    vatGroups.set(item.davek, { taxable: current.taxable + taxable, tax: current.tax + tax });
  }
  if (vatGroups.size === 0) {
    vatGroups.set(splosnaSt, { taxable: round2(data.skupaj - data.ddv), tax: data.ddv });
  }
  const taxesPerSeller = Array.from(vatGroups.entries())
    .sort(([left], [right]) => left - right)
    .map(([rate, amounts]) => ({
      taxRate: rate.toFixed(2),
      taxableAmount: amounts.taxable.toFixed(2),
      taxAmount: amounts.tax.toFixed(2),
    }));
  let referenceInvoice: CanonicalFursInvoiceFields["referenceInvoice"];
  if (data.jeStorno && data.izvornaStevRacuna) {
    const match = data.izvornaStevRacuna.match(/^(.+)-(.+)-\d+$/);
    referenceInvoice = {
      businessPremiseId: match?.[1] ?? businessPremiseId,
      electronicDeviceId: match?.[2] ?? electronicDeviceId,
      invoiceNumber: extractFursSeqNum(data.izvornaStevRacuna),
      issueDateTime: data.izvornaStevRacunaDatumCas
        ? toSloTimestamp(data.izvornaStevRacunaDatumCas)
        : toSloTimestamp(data.datumCas),
    };
  }
  const canonicalFields = immutableCanonicalFields({
    messageId,
    invoiceRequestId,
    taxNumber,
    issueDateTime: toSloTimestamp(data.datumCas),
    invoiceNumber: extractFursSeqNum(data.stevilkaRacuna),
    businessPremiseId,
    electronicDeviceId,
    invoiceAmount: data.skupaj.toFixed(2),
    paymentAmount: data.skupaj.toFixed(2),
    numberingStructure: "B",
    ...(data.kupecDavcnaStevilka ? { customerTaxNumber: data.kupecDavcnaStevilka } : {}),
    ...(data.operatorDavcna ? { operatorTaxNumber: data.operatorDavcna } : {}),
    taxesPerSeller,
    ...(referenceInvoice ? { referenceInvoice } : {}),
    zoiInput,
    zoi,
    certificateFingerprint: certFingerprint,
  });

  return Object.freeze({
    signedXml,
    signedXmlBytes,
    invoiceXml,
    zoi,
    certificateFingerprint: certFingerprint,
    canonicalFields,
    payloadHash: `sha256:${crypto.createHash("sha256").update(signedXmlBytes).digest("hex")}`,
  });
}

/**
 * Registrira poslovni prostor pri FURS z SOAP+XMLDSig.
 * Potrjena metoda (dekompilujan SLOTaxService.dll).
 */
export async function registrirajPoslovniProstorSOAP(
  data: FursPoslovniProstorData,
  fursNacin: FursNacin = "simulacija"
): Promise<FursPpOdgovor> {
  if (!data.certPem || !data.certKljuc) {
    return { uspeh: false, napaka: "FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.", surovOdgovor: "" };
  }
  const testniNacinUrl = fursNacin !== "produkcija";
  try {
    const innerXml = buildSOAPBPXML(data);
    // KRITIČNO: podpiši celoten SOAP dokument (ne standalone innerXml).
    // xml-crypto mora računati DigestValue v SOAP kontekstu (z vsemi namespace nodes od prednikov),
    // ker FURS pri verifikaciji vidi BusinessPremiseRequest znotraj celotnega SOAP dokumenta.
    // Brez tega C14N med podpisovanjem in verifikacijo producira različen output → S003.
    const soapBody = buildSOAPEnvelope(innerXml);
    const signedSoap = podpisiXML(soapBody, data.certPem, data.certKljuc);
    const fursOdgovor = await fursFetchSOAP(signedSoap, "/invoices/register", testniNacinUrl, data.proxyUrl, data.certPem, data.certKljuc);
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
    const napaka = sanitizeFursTransportError(err);
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
  // FURS SOAP klic z RSA ZOI + XMLDSig podpisom.
  if (!data.certPem || !data.certKljuc) {
    return { eor: "", zoi: "", uspeh: false, napaka: "FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.", surovOdgovor: "" };
  }

  try {
    const signedRequest = buildAndSignCanonicalFursInvoice(
      data,
      crypto.randomUUID(),
      splosnaSt,
    );
    return await posljiPodpisanFursRacun(signedRequest, {
      fursNacin,
      proxyUrl: data.proxyUrl,
      certPem: data.certPem,
      certKljuc: data.certKljuc,
    });
  } catch (err) {
    const napaka = sanitizeFursTransportError(err);
    return {
      eor: "", zoi: "", uspeh: false, napaka,
      surovOdgovor: JSON.stringify({ napaka }),
      // Construction/signing happens before delivery, so failure here is known.
      deliveryUnknown: false,
    };
  }
}

/**
 * Sends an already-signed request byte-for-byte and only parses/classifies the
 * response. It never rebuilds canonical fields and never accesses a signer.
 */
export async function posljiPodpisanFursRacun(
  request: SignedFursInvoiceRequest,
  options: FursSignedTransportOptions,
  transport: FursSoapTransport = fursFetchSOAP,
): Promise<FursSignedTransportResult> {
  const expectedHash = `sha256:${crypto.createHash("sha256").update(request.signedXmlBytes).digest("hex")}`;
  if (expectedHash !== request.payloadHash || !request.signedXmlBytes.equals(Buffer.from(request.signedXml, "utf8"))) {
    throw new Error("Podpisani FURS payload se ne ujema s shranjenim SHA-256 hashom.");
  }

  const base = { zoi: request.zoi, payloadHash: request.payloadHash };
  try {
    const response = await transport(
      request.signedXmlBytes,
      "/invoices",
      options.fursNacin !== "produkcija",
      options.proxyUrl,
      options.certPem,
      options.certKljuc,
    );
    const surovOdgovor = `[POSLAN XML]\n${request.invoiceXml}\n\n[HTTP ${response.statusCode}]\n${response.body}`;

    if (jeFursWafZavrnitev(response.body)) {
      return { ...base, eor: "", uspeh: false, napaka: "FURS WAF je zavrnil zahtevek: strežnik ni dosegljiv z vašega IP naslova. Potrebujete proxy strežnik v Sloveniji.", surovOdgovor, outcome: "failed" };
    }
    const fursNapaka = parseFursSoapError(response.body);
    if (fursNapaka) {
      return { ...base, eor: "", uspeh: false, napaka: `${fursNapaka.koda}: ${fursNapaka.sporocilo}`, surovOdgovor, outcome: "failed" };
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      const eor = response.body.match(/<(?:fu:)?UniqueInvoiceID>(.*?)<\/(?:fu:)?UniqueInvoiceID>/)?.[1]
        ?? response.body.match(/<EOR>(.*?)<\/EOR>/)?.[1] ?? "";
      const responseZoi = response.body.match(/<(?:fu:)?ProtectedID>(.*?)<\/(?:fu:)?ProtectedID>/)?.[1]
        ?? response.body.match(/<ZOI>(.*?)<\/ZOI>/)?.[1] ?? request.zoi;
      if (eor) return { ...base, eor, zoi: responseZoi, uspeh: true, surovOdgovor, outcome: "confirmed" };
    }
    return {
      ...base, eor: "", uspeh: false,
      napaka: `FURS napaka HTTP ${response.statusCode}`,
      surovOdgovor, deliveryUnknown: true, outcome: "unknown",
    };
  } catch (err) {
    const napaka = sanitizeFursTransportError(err);
    const deliveryUnknown = !(err instanceof FursProxyConfigurationError);
    return {
      ...base, eor: "", uspeh: false, napaka,
      surovOdgovor: JSON.stringify({ napaka }),
      deliveryUnknown,
      outcome: deliveryUnknown ? "unknown" : "failed",
    };
  }
}

/**
 * @deprecated Use buildLegalCore/buildSignedTransportAttempt. This remains for
 * current route callers and legacy-v1 evidence parsing only.
 *
 * Strictly deterministic construction seam: callers must persist/give the
 * MessageID rather than allowing this function to read randomness or time.
 */
export function buildAndSignCanonicalFursInvoice(
  data: FursRacunData,
  messageId: string,
  splosnaSt = 22,
  invoiceRequestId = "test",
): SignedFursInvoiceRequest {
  return zgradiInPodpisiFursRacun(data, splosnaSt, messageId, invoiceRequestId);
}

/** English API alias for the raw transport seam. */
export const submitSignedFursInvoice = posljiPodpisanFursRacun;

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
  fursNacin: FursNacin = "simulacija",
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
    const echoSoapSigned = podpisiXML(echoSoap, certPem, certKljuc);
    const odgovor = await fursFetchSOAP(echoSoapSigned, "/echo", fursNacin !== "produkcija", proxyUrl, certPem, certKljuc);
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
  return {
    certNajden: false,
    caCertPrenesen: false,
    echoGet: diagErr("Legacy FURS diagnostika je odstranjena."),
    echoPost: diagErr("Legacy FURS diagnostika je odstranjena."),
    echoPostPayload: diagErr("Legacy FURS diagnostika je odstranjena."),
    jwtWrapped: diagErr("Legacy FURS diagnostika je odstranjena."),
    jwtRaw: diagErr("Legacy FURS diagnostika je odstranjena."),
    jwtTestSupplier: diagErr("Legacy FURS diagnostika je odstranjena."),
    jwtNeveljaven: diagErr("Legacy FURS diagnostika je odstranjena."),
    jwtBrezWrapper: diagErr("Legacy FURS diagnostika je odstranjena."),
    xmlRaw: diagErr("Legacy FURS diagnostika je odstranjena."),
    xmlEcho: diagErr("Legacy FURS diagnostika je odstranjena."),
    soapEcho: diagErr("Legacy FURS diagnostika je odstranjena."),
    soapBP: diagErr("Legacy FURS diagnostika je odstranjena."),
  };
  if (false) {
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
        rejectUnauthorized: true,
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
      soapEcho = await fursFetchSOAP(echoSoap, "/echo", testniNacin, undefined, certPot, geslo);
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
        certPem: "",
        certKljuc: "",
      };
      const bpInner = buildSOAPBPXML(bpData);
      const bpSigned = podpisiXML(bpInner, certPot, geslo);
      const bpSoap = buildSOAPEnvelope(bpSigned);
      soapBP = await fursFetchSOAP(bpSoap, "/invoices/register", testniNacin, undefined, certPot, geslo);
    } catch (e) { soapBP = diagErr(e); }
  }

  const caCertPrenesen = fs.existsSync(caCertPot(certPot, testniNacin));
  return { certNajden, caCertPrenesen, echoGet, echoPost, echoPostPayload, jwtWrapped, jwtRaw, jwtTestSupplier, jwtNeveljaven, jwtBrezWrapper, xmlRaw, xmlEcho, soapEcho, soapBP };
}

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
