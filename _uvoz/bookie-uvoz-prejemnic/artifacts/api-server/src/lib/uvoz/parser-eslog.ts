// artifacts/api-server/src/lib/uvoz/parser-eslog.ts
//
// Razčlenjevalnik e-SLOG 2.0 / UBL 2.1 / Peppol BIS / CII (D16B).
//
// Odvisnosti:
//   npm i fast-xml-parser decimal.js
//
// e-SLOG 2.0 je v jedru profil UBL 2.1, zato en razčlenjevalnik pokrije
// e-SLOG 2.0, Peppol BIS Billing 3.0 in navadni UBL. CII je druga
// sintaksa istega standarda EN 16931 in ima ločeno vejo.
//
// VARNOST: fast-xml-parser ne razrešuje zunanjih entitet in ne bere DTD,
// zato je za dokumente iz e-poštnega predala primernejši od razčlenjevalnikov,
// ki to počnejo. processEntities je kljub temu izrecno izklopljen.

import { XMLParser } from 'fast-xml-parser';
import { Decimal } from 'decimal.js';

import {
  type Postavka,
  type PrejemDTO,
  UNECE_ENOTE,
  dodajNapako,
  dodajOpozorilo,
  gtinNorm,
  gtinVeljaven,
  postavkaSchema,
  prazenDto,
  zahtevaSamoobdavcitev,
  zaokrozi,
  DAVCNE_KATEGORIJE,
} from './dto';

// =====================================================================
// Nastavitev razčlenjevalnika
// =====================================================================

/**
 * Imenske predpone odstranimo (removeNSPrefix), ker e-SLOG, Peppol in
 * posamezni dobavitelji uporabljajo različne predpone za iste elemente.
 * Vrsto dokumenta določi korenski element, ne imenski prostor.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false, // vse kot niz — Decimal razčleni sam
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  isArray: (ime) =>
    [
      'InvoiceLine',
      'CreditNoteLine',
      'DespatchLine',
      'AllowanceCharge',
      'PartyTaxScheme',
      'TaxTotal',
      'IncludedSupplyChainTradeLineItem',
      'SpecifiedTaxRegistration',
    ].includes(ime),
});

// =====================================================================
// Pomožne funkcije za dostop
// =====================================================================

type Vozlisce = Record<string, unknown> | undefined;

/** Vrne besedilo elementa; upošteva obliko { '#text': ... } pri atributih. */
function t(vozlisce: unknown, ...pot: string[]): string | null {
  let v: unknown = vozlisce;
  for (const k of pot) {
    if (v === null || v === undefined || typeof v !== 'object') return null;
    v = (v as Record<string, unknown>)[k];
  }
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const besedilo = (v as Record<string, unknown>)['#text'];
    return besedilo === undefined ? null : String(besedilo).trim();
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

function d(vozlisce: unknown, ...pot: string[]): Decimal | null {
  const s = t(vozlisce, ...pot);
  if (s === null) return null;
  try {
    const dec = new Decimal(s.replace(/\s/g, ''));
    return dec.isFinite() ? dec : null;
  } catch {
    return null;
  }
}

function atr(vozlisce: unknown, ime: string): string | null {
  if (!vozlisce || typeof vozlisce !== 'object') return null;
  const v = (vozlisce as Record<string, unknown>)[`@${ime}`];
  return v === undefined || v === null ? null : String(v);
}

function vozel(vozlisce: unknown, ...pot: string[]): Vozlisce {
  let v: unknown = vozlisce;
  for (const k of pot) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return (v ?? undefined) as Vozlisce;
}

function seznam(vozlisce: unknown, ...pot: string[]): unknown[] {
  const v = vozel(vozlisce, ...pot);
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Datum iz UBL ('2026-01-03') ali CII ('20260103', format 102). */
function vDatumXml(surov: string | null, format?: string | null): string | null {
  if (!surov) return null;
  const s = surov.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (format === '102' && /^\d{8}$/.test(s))
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (format === '610' && /^\d{6}$/.test(s))
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

// =====================================================================
// Vstopna točka
// =====================================================================

export type XmlOblika =
  | 'UBL_INVOICE'
  | 'UBL_CREDITNOTE'
  | 'UBL_DESPATCH'
  | 'CII'
  | 'ESLOG_161'
  | 'NEZNANO';

export function zaznajOblikoXml(korenIme: string): XmlOblika {
  switch (korenIme) {
    case 'Invoice': return 'UBL_INVOICE';
    case 'CreditNote': return 'UBL_CREDITNOTE';
    case 'DespatchAdvice': return 'UBL_DESPATCH';
    case 'CrossIndustryInvoice': return 'CII';
    case 'Racun': return 'ESLOG_161';
    default: return 'NEZNANO';
  }
}

export function razcleniXml(xml: Buffer | string): PrejemDTO {
  const dto = prazenDto();
  let drevo: Record<string, unknown>;
  try {
    drevo = parser.parse(typeof xml === 'string' ? xml : xml.toString('utf-8'));
  } catch (e) {
    dodajNapako(dto, 'ZAJ004', 'B', `Datoteka ni veljaven XML: ${(e as Error).message}`);
    return dto;
  }

  const korenIme = Object.keys(drevo).find((k) => !k.startsWith('?'));
  if (!korenIme) {
    dodajNapako(dto, 'ZAJ004', 'B', 'XML nima korenskega elementa.');
    return dto;
  }

  const oblika = zaznajOblikoXml(korenIme);
  const koren = drevo[korenIme] as Record<string, unknown>;

  switch (oblika) {
    case 'UBL_INVOICE':
    case 'UBL_CREDITNOTE':
    case 'UBL_DESPATCH':
      return razcleniUbl(koren, oblika, dto);
    case 'CII':
      return razcleniCii(koren, dto);
    case 'ESLOG_161':
      // Obravnava je v parser-eslog161.ts; sem dokument ne bi smel priti,
      // ker ga zaznajFormat usmeri drugam. Če pride, je napaka v razpoznavi.
      dodajNapako(dto, 'ZAJ009', 'B',
        'e-SLOG 1.6.1 je bil poslan napačnemu razčlenjevalniku. ' +
        'Uporabite razcleniEslog161().');
      return dto;
    default:
      dodajNapako(dto, 'ZAJ002', 'B', `Neprepoznan korenski element: ${korenIme}`);
      return dto;
  }
}

// =====================================================================
// UBL / e-SLOG 2.0 / Peppol
// =====================================================================

function razcleniUbl(k: Vozlisce, oblika: XmlOblika, dto: PrejemDTO): PrejemDTO {
  // ---- glava ----
  dto.stDokumenta = t(k, 'ID');
  dto.datumDokumenta = vDatumXml(t(k, 'IssueDate'));
  dto.valuta = t(k, 'DocumentCurrencyCode') ?? 'EUR';
  dto.ceneBruto = false; // EN 16931 je vedno neto

  const koda = t(k, 'InvoiceTypeCode') ?? t(k, 'DocumentTypeCode');
  const vrste: Record<string, PrejemDTO['vrstaDokumenta']> = {
    '380': 'RACUN', '381': 'DOBROPIS', '383': 'BREMEPIS', '351': 'DOBAVNICA',
  };
  dto.vrstaDokumenta =
    oblika === 'UBL_CREDITNOTE' ? 'DOBROPIS'
    : oblika === 'UBL_DESPATCH' ? 'DOBAVNICA'
    : (koda && vrste[koda]) || 'RACUN';

  // ---- dobavitelj ----
  const stranka =
    vozel(k, 'AccountingSupplierParty', 'Party') ??
    vozel(k, 'DespatchSupplierParty', 'Party');

  if (!stranka) {
    dodajNapako(dto, 'DOK001', 'B', 'Dokument ne vsebuje podatkov o dobavitelju.');
  } else {
    dto.dobaviteljNaziv =
      t(stranka, 'PartyName', 'Name') ?? t(stranka, 'PartyLegalEntity', 'RegistrationName');
    dto.dobaviteljGln = t(stranka, 'EndpointID');
    dto.dobaviteljDrzava = t(stranka, 'PostalAddress', 'Country', 'IdentificationCode');

    // ID za DDV: poišči shemo VAT, ne prve po vrsti
    for (const ts of seznam(stranka, 'PartyTaxScheme')) {
      const shema = t(ts, 'TaxScheme', 'ID');
      if (shema && ['VAT', 'DDV'].includes(shema.toUpperCase())) {
        dto.dobaviteljIdDdv = t(ts, 'CompanyID');
        break;
      }
    }
    dto.dobaviteljIdDdv ??= t(vozel(stranka, 'PartyTaxScheme'), 'CompanyID');

    if (dto.dobaviteljIdDdv) {
      const cifre = dto.dobaviteljIdDdv.replace(/\D/g, '');
      dto.dobaviteljDavcna = cifre.length >= 8 ? cifre.slice(-8) : null;
    }
  }

  // ---- rabati in stroški na ravni glave ----
  for (const ac of seznam(k, 'AllowanceCharge')) {
    const jeStrosek = (t(ac, 'ChargeIndicator') ?? 'false').toLowerCase() === 'true';
    const znesek = d(ac, 'Amount') ?? new Decimal(0);
    const razlog = t(ac, 'AllowanceChargeReason');
    if (jeStrosek) {
      dto.odvisniStroski.push({
        vrsta: (t(ac, 'AllowanceChargeReasonCode') ?? 'DRUGO'),
        razlog,
        znesek,
        ddvStopnja: d(ac, 'TaxCategory', 'Percent'),
      });
    } else {
      dto.rabatiGlave.push({ razlog, znesek });
    }
  }

  // ---- postavke ----
  if (oblika === 'UBL_DESPATCH') postavkeDobavnica(k, dto);
  else postavkeRacun(k, dto);

  // ---- vsote ----
  dto.izvOsnova = d(k, 'LegalMonetaryTotal', 'TaxExclusiveAmount');
  dto.izvSkupaj = d(k, 'LegalMonetaryTotal', 'TaxInclusiveAmount');
  const tt = seznam(k, 'TaxTotal')[0];
  dto.izvDdv = tt ? d(tt, 'TaxAmount') : null;

  preveriDokument(dto);
  return dto;
}

function postavkeRacun(k: Vozlisce, dto: PrejemDTO): void {
  const vrstice = [...seznam(k, 'InvoiceLine'), ...seznam(k, 'CreditNoteLine')];

  vrstice.forEach((v, i) => {
    const kolEl = vozel(v, 'InvoicedQuantity') ?? vozel(v, 'CreditedQuantity');
    const kolicina =
      d(v, 'InvoicedQuantity') ?? d(v, 'CreditedQuantity') ?? new Decimal(0);
    const enotaKoda = atr(kolEl, 'unitCode');

    const artikel = vozel(v, 'Item');
    const cenaVozel = vozel(v, 'Price');

    // ===== PAST: cena je lahko kotirana za več enot =====
    // Dobavitelji pogosto navedejo ceno za 100 ali 1000 kosov. Brez
    // deljenja z BaseQuantity je nabavna cena stokrat previsoka in
    // napake ni videti nikjer do inventure.
    const cenaSurova = d(cenaVozel, 'PriceAmount') ?? new Decimal(0);
    let osnovnaKol = d(cenaVozel, 'BaseQuantity') ?? new Decimal(1);
    if (osnovnaKol.lte(0)) osnovnaKol = new Decimal(1);
    const cenaNaEnoto = cenaSurova.div(osnovnaKol);

    const p: Postavka = postavkaSchema.parse({
      zap: Number(t(v, 'ID') ?? i + 1) || i + 1,
      izvNaziv: t(artikel, 'Name') ?? '(brez naziva)',
      izvKolicina: kolicina,
      izvCena: cenaNaEnoto,
      izvEnota: enotaKoda ? (UNECE_ENOTE[enotaKoda] ?? enotaKoda) : null,
      izvGtin: gtinNorm(t(artikel, 'StandardItemIdentification', 'ID')),
      izvSifra: t(artikel, 'SellersItemIdentification', 'ID'),
      izvVrednost: d(v, 'LineExtensionAmount'),
      ddvStopnja: d(artikel, 'ClassifiedTaxCategory', 'Percent'),
      ddvKategorija: t(artikel, 'ClassifiedTaxCategory', 'ID'),
      lot: t(artikel, 'ItemInstance', 'LotIdentification', 'LotNumberID'),
      rokUporabe: vDatumXml(t(artikel, 'ItemInstance', 'BestBeforeDate')),
    });

    if (!osnovnaKol.eq(1)) {
      dodajOpozorilo(p, 'POS017', 'I',
        `Cena na dokumentu velja za ${osnovnaKol} enot; preračunana na eno enoto.`,
        {
          cenaNaDokumentu: cenaSurova.toString(),
          osnovnaKolicina: osnovnaKol.toString(),
          cenaNaEnoto: cenaNaEnoto.toString(),
        });
    }

    // rabat na ravni cene
    const ac = seznam(cenaVozel, 'AllowanceCharge')[0];
    if (ac) {
      const osnova = d(ac, 'BaseAmount');
      const znesek = d(ac, 'Amount');
      if (osnova && znesek && osnova.gt(0)) {
        p.rabat1Odst = zaokrozi(znesek.div(osnova).mul(100), 4);
      }
    }

    // samoobdavčitev
    if (zahtevaSamoobdavcitev(p.ddvKategorija)) {
      dto.samoobdavcitev = true;
      const k = p.ddvKategorija as keyof typeof DAVCNE_KATEGORIJE;
      dodajOpozorilo(p, 'POS018', 'O',
        `Kategorija ${k} — ${DAVCNE_KATEGORIJE[k].opis}. ` +
        'Zahteva samoobdavčitev in vpis v obe evidenci.',
        { kategorija: k });
    }

    preveriPostavko(p);
    dto.postavke.push(p);
  });
}

function postavkeDobavnica(k: Vozlisce, dto: PrejemDTO): void {
  seznam(k, 'DespatchLine').forEach((v, i) => {
    const kolEl = vozel(v, 'DeliveredQuantity');
    const enotaKoda = atr(kolEl, 'unitCode');
    const artikel = vozel(v, 'Item');

    const p: Postavka = postavkaSchema.parse({
      zap: Number(t(v, 'ID') ?? i + 1) || i + 1,
      izvNaziv: t(artikel, 'Name') ?? '(brez naziva)',
      izvKolicina: d(v, 'DeliveredQuantity') ?? new Decimal(0),
      izvCena: new Decimal(0), // dobavnica praviloma nima cen
      izvEnota: enotaKoda ? (UNECE_ENOTE[enotaKoda] ?? enotaKoda) : null,
      izvGtin: gtinNorm(t(artikel, 'StandardItemIdentification', 'ID')),
      izvSifra: t(artikel, 'SellersItemIdentification', 'ID'),
      lot: t(artikel, 'ItemInstance', 'LotIdentification', 'LotNumberID'),
      rokUporabe: vDatumXml(t(artikel, 'ItemInstance', 'BestBeforeDate')),
    });
    preveriPostavko(p);
    dto.postavke.push(p);
  });

  dodajNapako(dto, 'DOK013', 'I',
    'eDobavnica ne vsebuje cen. Cene se prevzamejo iz zapomnjenih preslikav ' +
    'ali dopolnijo ob prejemu računa.');
}

// =====================================================================
// CII (UN/CEFACT D16B)
// =====================================================================

function razcleniCii(k: Vozlisce, dto: PrejemDTO): PrejemDTO {
  const dok = vozel(k, 'ExchangedDocument');
  dto.stDokumenta = t(dok, 'ID');
  const datumEl = vozel(dok, 'IssueDateTime', 'DateTimeString');
  dto.datumDokumenta = vDatumXml(
    t(dok, 'IssueDateTime', 'DateTimeString'),
    atr(datumEl, 'format') ?? '102',
  );

  const prodajalec = vozel(
    k, 'SupplyChainTradeTransaction', 'ApplicableHeaderTradeAgreement', 'SellerTradeParty',
  );
  if (prodajalec) {
    dto.dobaviteljNaziv = t(prodajalec, 'Name');
    for (const reg of seznam(prodajalec, 'SpecifiedTaxRegistration')) {
      const idEl = vozel(reg, 'ID');
      if (atr(idEl, 'schemeID') === 'VA') {
        dto.dobaviteljIdDdv = t(reg, 'ID');
        const cifre = (dto.dobaviteljIdDdv ?? '').replace(/\D/g, '');
        dto.dobaviteljDavcna = cifre.length >= 8 ? cifre.slice(-8) : null;
        break;
      }
    }
  }

  const vrstice = seznam(
    k, 'SupplyChainTradeTransaction', 'IncludedSupplyChainTradeLineItem',
  );

  vrstice.forEach((v, i) => {
    const izdelek = vozel(v, 'SpecifiedTradeProduct');
    const dogovor = vozel(v, 'SpecifiedLineTradeAgreement');
    const dobava = vozel(v, 'SpecifiedLineTradeDelivery');
    const poravnava = vozel(v, 'SpecifiedLineTradeSettlement');

    const kolEl = vozel(dobava, 'BilledQuantity');
    const enotaKoda = atr(kolEl, 'unitCode');

    const cenaSurova =
      d(dogovor, 'NetPriceProductTradePrice', 'ChargeAmount') ?? new Decimal(0);
    let osnovnaKol =
      d(dogovor, 'NetPriceProductTradePrice', 'BasisQuantity') ?? new Decimal(1);
    if (osnovnaKol.lte(0)) osnovnaKol = new Decimal(1);

    const p: Postavka = postavkaSchema.parse({
      zap: Number(t(v, 'AssociatedDocumentLineDocument', 'LineID') ?? i + 1) || i + 1,
      izvNaziv: t(izdelek, 'Name') ?? '(brez naziva)',
      izvKolicina: d(dobava, 'BilledQuantity') ?? new Decimal(0),
      izvCena: cenaSurova.div(osnovnaKol),
      izvEnota: enotaKoda ? (UNECE_ENOTE[enotaKoda] ?? enotaKoda) : null,
      izvGtin: gtinNorm(t(izdelek, 'GlobalID')),
      izvSifra: t(izdelek, 'SellerAssignedID'),
      izvVrednost: d(
        poravnava, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount',
      ),
      ddvStopnja: d(poravnava, 'ApplicableTradeTax', 'RateApplicablePercent'),
      ddvKategorija: t(poravnava, 'ApplicableTradeTax', 'CategoryCode'),
    });

    if (!osnovnaKol.eq(1)) {
      dodajOpozorilo(p, 'POS017', 'I',
        `Cena velja za ${osnovnaKol} enot; preračunana na eno enoto.`,
        { osnovnaKolicina: osnovnaKol.toString() });
    }
    if (zahtevaSamoobdavcitev(p.ddvKategorija)) dto.samoobdavcitev = true;

    preveriPostavko(p);
    dto.postavke.push(p);
  });

  const vsote = vozel(
    k, 'SupplyChainTradeTransaction', 'ApplicableHeaderTradeSettlement',
    'SpecifiedTradeSettlementHeaderMonetarySummation',
  );
  dto.izvOsnova = d(vsote, 'TaxBasisTotalAmount');
  dto.izvDdv = d(vsote, 'TaxTotalAmount');
  dto.izvSkupaj = d(vsote, 'GrandTotalAmount');

  preveriDokument(dto);
  return dto;
}

// =====================================================================
// Kontrole
// =====================================================================

function preveriPostavko(p: Postavka): void {
  if (p.izvGtin && !gtinVeljaven(p.izvGtin)) {
    dodajOpozorilo(p, 'POS008', 'O', 'Črtna koda ne prestane kontrolne števke.', {
      gtin: p.izvGtin,
    });
  }

  if (p.izvVrednost !== null && p.izvCena.gt(0)) {
    const izracun = p.izvKolicina.mul(p.izvCena);
    if (zaokrozi(izracun).minus(zaokrozi(p.izvVrednost)).abs().gt('0.02')) {
      dodajOpozorilo(p, 'POS007', 'B',
        'Količina × cena se ne ujema z vrednostjo postavke. Preverite BaseQuantity.',
        {
          izracunano: zaokrozi(izracun).toString(),
          naDokumentu: zaokrozi(p.izvVrednost).toString(),
        });
    }
  }
}

function preveriDokument(dto: PrejemDTO): void {
  if (!dto.postavke.length) {
    dodajNapako(dto, 'DOK010', 'B', 'Dokument ne vsebuje postavk.');
    return;
  }

  if (dto.izvOsnova !== null) {
    let vsota = dto.postavke.reduce(
      (a, p) => a.plus(p.izvVrednost ?? p.izvKolicina.mul(p.izvCena)),
      new Decimal(0),
    );
    vsota = vsota.minus(
      dto.rabatiGlave.reduce((a, r) => a.plus(r.znesek), new Decimal(0)),
    );
    vsota = vsota.plus(
      dto.odvisniStroski.reduce((a, s) => a.plus(s.znesek), new Decimal(0)),
    );

    if (zaokrozi(vsota).minus(zaokrozi(dto.izvOsnova)).abs().gt('0.02')) {
      dodajNapako(dto, 'DOK004', 'B',
        'Vsota postavk se ne ujema z davčno osnovo dokumenta.',
        {
          vsotaPostavk: zaokrozi(vsota).toString(),
          osnovaNaDokumentu: zaokrozi(dto.izvOsnova).toString(),
        });
    }
  }

  if (dto.samoobdavcitev) {
    dodajNapako(dto, 'DOK014', 'O',
      'Dokument vsebuje postavke z obrnjeno davčno obveznostjo oziroma ' +
      'pridobitvijo znotraj EU. Potrebno je ločeno knjiženje samoobdavčitve ' +
      'in vpis v knjigo izdanih ter knjigo prejetih računov.');
  }
}
