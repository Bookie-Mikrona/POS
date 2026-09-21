// artifacts/api-server/src/lib/eracun/generator.ts
//
// Generator izhodnega e-SLOG 2.0 / UBL 2.1 Invoice XML za POS izdane račune.
//
// Specifikacija:
//   - CustomizationID: e-SLOG 2.0 (urn:cen.eu:en16931:2017#compliant#urn:fdc:si.efaktura.mg:2.0)
//   - Peppol BIS Billing 3.0 veja: TODO (oznaka spodaj), privzeto e-SLOG 2.0
//   - Vse decimalne operacije prek Decimal.js — BREZ float aritmetike
//   - Cene na POS postavkah so bruto (DDV vključen); generator preračuna na neto
//
// Vstopna točka: generirajEracunXml(input: EracunInput): string

import { create } from 'xmlbuilder2';
import { Decimal } from 'decimal.js';

// ---------------------------------------------------------------------------
// Vhodni tipi
// ---------------------------------------------------------------------------

export interface EracunIzdajatelj {
  naziv: string;
  ulica?: string | null;
  postnaStevika?: string | null;  // pozor: typo je iz DB sheme
  kraj?: string | null;
  drzava?: string | null;
  kodaDrzave?: string | null;
  podjetjeDavcna: string;           // 8-mestna davčna brez SI
  idZaDdv?: string | null;          // npr. SI12345678
  maticnaStevilka?: string | null;
  trr?: Array<{ iban: string; bic: string }> | null;
}

export interface EracunPrejemnik {
  naziv: string;
  naslov?: string | null;           // kombiniran naslov ali
  ulica?: string | null;
  postnaStevilka?: string | null;
  kraj?: string | null;
  drzava?: string | null;
  kodaDrzave?: string | null;
  davcnaStevilka?: string | null;   // 8-mestna brez SI
  idZaDdv?: string | null;          // npr. SI12345678
  maticnaStevilka?: string | null;
  eRacunNaslov?: string | null;     // endpoint/GLN v omrežju
  eRacunSifraPu?: string | null;    // šifra proračunskega uporabnika
  eRacunBic?: string | null;
  eRacunOmrezje?: string | null;    // 'UJP' | 'PEPPOL' | 'BizBox' | null
  trr?: Array<{ iban: string; bic: string }> | null;
}

export interface EracunPostavka {
  ime: string;
  kolicina: Decimal | number | string;
  /** Bruto cena na enoto (z DDV). Generator sam preračuna na neto. */
  cenaBrutoKos: Decimal | number | string;
  /** DDV stopnja v % (npr. 22, 9.5, 0). */
  davek: Decimal | number | string;
}

export interface EracunInput {
  stevilkaRacuna: string;
  datumCas: Date;
  dniOdloga?: number | null;
  /** Skupaj z DDV (avtoritativno — vzeto iz shranjenih polj na računu). */
  skupaj: Decimal | number | string;
  /** DDV znesek (avtoritativno). */
  ddv: Decimal | number | string;
  /** Davčna osnova brez DDV (avtoritativno). */
  osnova: Decimal | number | string;
  postavke: EracunPostavka[];
  izdajatelj: EracunIzdajatelj;
  prejemnik: EracunPrejemnik;
}

// ---------------------------------------------------------------------------
// Pomožne funkcije
// ---------------------------------------------------------------------------

const D = (v: Decimal | number | string): Decimal => new Decimal(v);
const fmt2 = (d: Decimal): string => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const fmtDatum = (d: Date): string =>
  d.toISOString().slice(0, 10); // YYYY-MM-DD

/** DDV kategorija ID po EN 16931 UNCL5305. */
function ddvKategorijaId(stopnja: Decimal): string {
  if (stopnja.gt(0)) return 'S';   // standardna / znižana stopnja
  return 'Z';                       // ničelna stopnja (0 %)
  // Za oproščeno (E) bi potrebovali ločen označevalnik na postavki — za zdaj
  // je 0 % zavezanec = Z (ničelna stopnja).
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Zgradi e-SLOG 2.0 / UBL 2.1 Invoice XML iz podatkov POS računa.
 *
 * @throws Error ko so vhodni podatki nekonzistentni (nič postavk, ipd.)
 */
export function generirajEracunXml(input: EracunInput): string {
  const { stevilkaRacuna, datumCas, dniOdloga, postavke, izdajatelj, prejemnik } = input;

  if (!postavke.length) throw new Error('e-SLOG: račun nima postavk');

  // Avtoritativni skupni zneski (iz baze — zaokroženi)
  const skupajAuth = D(input.skupaj);
  const ddvAuth = D(input.ddv);
  const osnovaAuth = D(input.osnova);

  // Datum zapadlosti
  const datumIzdaje = fmtDatum(datumCas);
  const datumZapad = dniOdloga != null && dniOdloga > 0
    ? fmtDatum(new Date(datumCas.getTime() + dniOdloga * 86_400_000))
    : datumIzdaje;

  // ── Izračun postavk (neto) ──────────────────────────────────────────
  interface LinijaDdv {
    stopnja: Decimal;
    osnova: Decimal;   // seštevek neto vrednosti za to stopnjo
  }
  const ddvSkupine = new Map<string, LinijaDdv>(); // ključ: stopnja.toString()
  let vsotaLinij = new Decimal(0); // vsota neto vrednosti vseh vrstic

  const vrstice: Array<{
    zap: number;
    ime: string;
    kolicina: Decimal;
    cenaNeto: Decimal;
    vrednostNeto: Decimal;
    stopnja: Decimal;
    kategorijaId: string;
  }> = [];

  for (let i = 0; i < postavke.length; i++) {
    const p = postavke[i];
    const kolicina = D(p.kolicina);
    const cenaBruto = D(p.cenaBrutoKos);
    const stopnja = D(p.davek);

    // Preračun bruto → neto cena (POS cene so z DDV)
    const divisor = new Decimal(1).plus(stopnja.div(100));
    const cenaNeto = divisor.gt(0) ? cenaBruto.div(divisor) : cenaBruto;
    const vrednostNeto = kolicina.mul(cenaNeto).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    vsotaLinij = vsotaLinij.plus(vrednostNeto);

    const kljuc = stopnja.toString();
    if (!ddvSkupine.has(kljuc)) {
      ddvSkupine.set(kljuc, { stopnja, osnova: new Decimal(0) });
    }
    ddvSkupine.get(kljuc)!.osnova = ddvSkupine.get(kljuc)!.osnova.plus(vrednostNeto);

    vrstice.push({
      zap: i + 1,
      ime: p.ime,
      kolicina,
      cenaNeto,
      vrednostNeto,
      stopnja,
      kategorijaId: ddvKategorijaId(stopnja),
    });
  }

  // Razlika med seštevkom vrstic in avtoritativno osnovo (zaokrožitvene razlike)
  // Razdelimo razliko na prvo skupino (standardna praksa)
  const razlikaOsnova = osnovaAuth.minus(vsotaLinij).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (razlikaOsnova.abs().gt('0.10')) {
    throw new Error(
      `e-SLOG: razlika osnov prevelika: avtoritativna=${fmt2(osnovaAuth)}, ` +
      `vsota vrstic=${fmt2(vsotaLinij)}, razlika=${fmt2(razlikaOsnova)}`
    );
  }
  // Korekcija osnove na prvi skupini
  const skupineArr = [...ddvSkupine.values()].sort((a, b) =>
    b.stopnja.comparedTo(a.stopnja)  // descending: najprej 22 %, nato 9.5 %, nato 0 %
  );
  if (skupineArr.length > 0) {
    skupineArr[0].osnova = skupineArr[0].osnova.plus(razlikaOsnova)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  // DDV po skupinah
  const ddvSkupineRacun: Array<{ stopnja: Decimal; osnova: Decimal; ddv: Decimal; kategorijaId: string }> = [];
  let ddvVsota = new Decimal(0);
  for (const sk of skupineArr) {
    const ddvZnesek = sk.osnova.mul(sk.stopnja).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    ddvVsota = ddvVsota.plus(ddvZnesek);
    ddvSkupineRacun.push({
      stopnja: sk.stopnja,
      osnova: sk.osnova,
      ddv: ddvZnesek,
      kategorijaId: ddvKategorijaId(sk.stopnja),
    });
  }
  // Popravi skupni DDV na avtoritativno vrednost
  const razlikaDdv = ddvAuth.minus(ddvVsota).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (razlikaDdv.abs().gt('0.10')) {
    throw new Error(
      `e-SLOG: razlika DDV prevelika: avtoritativni=${fmt2(ddvAuth)}, ` +
      `izračunan=${fmt2(ddvVsota)}, razlika=${fmt2(razlikaDdv)}`
    );
  }
  if (ddvSkupineRacun.length > 0) {
    ddvSkupineRacun[0].ddv = ddvSkupineRacun[0].ddv.plus(razlikaDdv)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  // TODO: Peppol BIS Billing 3.0
  // Kadar bo eRacunOmrezje === 'PEPPOL', je treba spremeniti CustomizationID in ProfileID
  // na urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:01:1.0
  // ter dodati Peppol specifične elemente (EndpointID z @schemeID="0184" za SI).
  // Za zdaj gradi e-SLOG 2.0 za vse.
  const customizationId = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:si.efaktura.mg:2.0';

  // ── Gradnja XML ────────────────────────────────────────────────────
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Invoice', {
      'xmlns': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    });

  doc.ele('cbc:CustomizationID').txt(customizationId);
  doc.ele('cbc:ID').txt(stevilkaRacuna);
  doc.ele('cbc:IssueDate').txt(datumIzdaje);
  if (datumZapad !== datumIzdaje) doc.ele('cbc:DueDate').txt(datumZapad);
  doc.ele('cbc:InvoiceTypeCode').txt('380');        // 380 = komercialni račun
  doc.ele('cbc:DocumentCurrencyCode').txt('EUR');

  // ── AccountingSupplierParty ────────────────────────────────────────
  const supplier = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');

  // EndpointID: za e-SLOG 2.0 SI je shema "SI:VAT"
  if (izdajatelj.idZaDdv) {
    supplier.ele('cbc:EndpointID', { 'schemeID': 'SI:VAT' }).txt(izdajatelj.idZaDdv);
  }

  supplier.ele('cac:PartyName').ele('cbc:Name').txt(izdajatelj.naziv);

  const suppAddr = supplier.ele('cac:PostalAddress');
  if (izdajatelj.ulica) suppAddr.ele('cbc:StreetName').txt(izdajatelj.ulica);
  if (izdajatelj.postnaStevika) suppAddr.ele('cbc:PostalZone').txt(izdajatelj.postnaStevika);
  if (izdajatelj.kraj) suppAddr.ele('cbc:CityName').txt(izdajatelj.kraj);
  suppAddr.ele('cac:Country').ele('cbc:IdentificationCode')
    .txt(izdajatelj.kodaDrzave ?? izdajatelj.drzava ?? 'SI');

  if (izdajatelj.idZaDdv) {
    supplier.ele('cac:PartyTaxScheme')
      .ele('cbc:CompanyID').txt(izdajatelj.idZaDdv).up()
      .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  }

  const suppLegal = supplier.ele('cac:PartyLegalEntity');
  suppLegal.ele('cbc:RegistrationName').txt(izdajatelj.naziv);
  if (izdajatelj.maticnaStevilka) suppLegal.ele('cbc:CompanyID').txt(izdajatelj.maticnaStevilka);

  // ── AccountingCustomerParty ────────────────────────────────────────
  const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');

  if (prejemnik.eRacunNaslov) {
    // GLN ali drug omrežni naslov
    const schemeId = prejemnik.eRacunOmrezje === 'PEPPOL' ? '0184' : 'SI:UJP';
    customer.ele('cbc:EndpointID', { 'schemeID': schemeId }).txt(prejemnik.eRacunNaslov);
  } else if (prejemnik.idZaDdv) {
    customer.ele('cbc:EndpointID', { 'schemeID': 'SI:VAT' }).txt(prejemnik.idZaDdv);
  }

  customer.ele('cac:PartyName').ele('cbc:Name').txt(prejemnik.naziv);

  const custAddr = customer.ele('cac:PostalAddress');
  // Prejemnik ima lahko kombiniran naslov ali ločene komponente
  if (prejemnik.ulica) {
    custAddr.ele('cbc:StreetName').txt(prejemnik.ulica);
    if (prejemnik.postnaStevilka) custAddr.ele('cbc:PostalZone').txt(prejemnik.postnaStevilka);
    if (prejemnik.kraj) custAddr.ele('cbc:CityName').txt(prejemnik.kraj);
  } else if (prejemnik.naslov) {
    custAddr.ele('cbc:StreetName').txt(prejemnik.naslov);
  }
  custAddr.ele('cac:Country').ele('cbc:IdentificationCode')
    .txt(prejemnik.kodaDrzave ?? prejemnik.drzava ?? 'SI');

  if (prejemnik.idZaDdv) {
    customer.ele('cac:PartyTaxScheme')
      .ele('cbc:CompanyID').txt(prejemnik.idZaDdv).up()
      .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  }

  const custLegal = customer.ele('cac:PartyLegalEntity');
  custLegal.ele('cbc:RegistrationName').txt(prejemnik.naziv);
  if (prejemnik.maticnaStevilka) custLegal.ele('cbc:CompanyID').txt(prejemnik.maticnaStevilka);
  if (prejemnik.eRacunSifraPu) custLegal.ele('cbc:CompanyLegalForm').txt(`SifraPU:${prejemnik.eRacunSifraPu}`);

  // ── PaymentMeans ───────────────────────────────────────────────────
  const pm = doc.ele('cac:PaymentMeans');
  pm.ele('cbc:PaymentMeansCode').txt('30');        // 30 = nakazilo na TRR
  if (datumZapad !== datumIzdaje) pm.ele('cbc:PaymentDueDate').txt(datumZapad);

  const ibanSource = izdajatelj.trr && izdajatelj.trr.length > 0 ? izdajatelj.trr[0] : null;
  if (ibanSource) {
    const pfa = pm.ele('cac:PayeeFinancialAccount');
    pfa.ele('cbc:ID').txt(ibanSource.iban);
    if (ibanSource.bic) {
      pfa.ele('cac:FinancialInstitutionBranch').ele('cbc:ID').txt(ibanSource.bic);
    }
  }

  // ── TaxTotal ───────────────────────────────────────────────────────
  const taxTotal = doc.ele('cac:TaxTotal');
  taxTotal.ele('cbc:TaxAmount', { 'currencyID': 'EUR' }).txt(fmt2(ddvAuth));

  for (const sk of ddvSkupineRacun) {
    const sub = taxTotal.ele('cac:TaxSubtotal');
    sub.ele('cbc:TaxableAmount', { 'currencyID': 'EUR' }).txt(fmt2(sk.osnova));
    sub.ele('cbc:TaxAmount', { 'currencyID': 'EUR' }).txt(fmt2(sk.ddv));
    const cat = sub.ele('cac:TaxCategory');
    cat.ele('cbc:ID').txt(sk.kategorijaId);
    cat.ele('cbc:Percent').txt(sk.stopnja.toFixed(2));
    cat.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  }

  // ── LegalMonetaryTotal ─────────────────────────────────────────────
  const lmt = doc.ele('cac:LegalMonetaryTotal');
  // LineExtensionAmount = vsota neto vrednosti vrstic (pred korekcijo)
  lmt.ele('cbc:LineExtensionAmount', { 'currencyID': 'EUR' }).txt(fmt2(vsotaLinij.plus(razlikaOsnova)));
  lmt.ele('cbc:TaxExclusiveAmount', { 'currencyID': 'EUR' }).txt(fmt2(osnovaAuth));
  lmt.ele('cbc:TaxInclusiveAmount', { 'currencyID': 'EUR' }).txt(fmt2(skupajAuth));
  lmt.ele('cbc:PayableAmount', { 'currencyID': 'EUR' }).txt(fmt2(skupajAuth));

  // ── InvoiceLine ────────────────────────────────────────────────────
  for (const v of vrstice) {
    const line = doc.ele('cac:InvoiceLine');
    line.ele('cbc:ID').txt(String(v.zap));
    line.ele('cbc:InvoicedQuantity', { 'unitCode': 'H87' })  // H87 = kos (PCE)
        .txt(v.kolicina.toFixed(3).replace(/\.?0+$/, '') || '1');
    line.ele('cbc:LineExtensionAmount', { 'currencyID': 'EUR' }).txt(fmt2(v.vrednostNeto));

    const item = line.ele('cac:Item');
    item.ele('cbc:Name').txt(v.ime);
    const classifiedTax = item.ele('cac:ClassifiedTaxCategory');
    classifiedTax.ele('cbc:ID').txt(v.kategorijaId);
    classifiedTax.ele('cbc:Percent').txt(v.stopnja.toFixed(2));
    classifiedTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');

    const price = line.ele('cac:Price');
    price.ele('cbc:PriceAmount', { 'currencyID': 'EUR' })
         .txt(v.cenaNeto.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));
  }

  return doc.end({ prettyPrint: true });
}
