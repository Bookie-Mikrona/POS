import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { prazenDto, prejemDtoSchema } from './dto';

describe('prejemDtoSchema', () => {
  it('po JSON shranjevanju obnovi Decimal polja OCR seje', () => {
    const dto = prazenDto();
    dto.postavke.push({
      zap: 1,
      izvNaziv: 'Kava',
      izvGtin: null,
      izvSifra: '94545',
      izvEnota: 'KOS',
      izvKolicina: new Decimal('2'),
      izvCena: new Decimal('15.50'),
      izvVrednost: null,
      enotVPaketu: new Decimal('6'),
      rabat1Odst: new Decimal('10'),
      rabat2Odst: new Decimal('0'),
      rabatVkljucenVCeni: false,
      ddvStopnja: new Decimal('9.5'),
      ddvKategorija: 'S',
      ddvOsnova: null,
      ddvZnesek: null,
      ddvKoda: null,
      vrsticaTip: 'zaloga',
      lot: null,
      rokUporabe: null,
      opozorila: [],
    });

    const obnovljen = prejemDtoSchema.parse(JSON.parse(JSON.stringify(dto)));
    const postavka = obnovljen.postavke[0]!;

    expect(postavka.enotVPaketu.gt(0)).toBe(true);
    expect(postavka.izvCena.div(postavka.enotVPaketu).toString()).toBe('2.583333333333333333333333333');
    expect(postavka.izvKolicina.mul(postavka.enotVPaketu).toString()).toBe('12');
    expect(postavka.rabat1Odst.toString()).toBe('10');
    expect(postavka.ddvStopnja?.toString()).toBe('9.5');
  });

  it('ohrani vse plačilne podatke fakture-dobavnice', () => {
    const dto = prejemDtoSchema.parse({
      vrstaDokumenta: 'RACUN',
      datumZapadlosti: '2026-10-10',
      dobaviteljIban: 'SI56191000000123456',
      dobaviteljBic: 'SZKBSI2X',
      placilniNacin: 'Nakazilo na TRR',
      placilniModel: 'SI00',
      placilniSklic: '2026-12345',
      placilniNamen: 'Plačilo fakture-dobavnice 12345',
    });

    expect(dto).toMatchObject({
      vrstaDokumenta: 'RACUN',
      datumZapadlosti: '2026-10-10',
      dobaviteljIban: 'SI56191000000123456',
      dobaviteljBic: 'SZKBSI2X',
      placilniNacin: 'Nakazilo na TRR',
      placilniModel: 'SI00',
      placilniSklic: '2026-12345',
      placilniNamen: 'Plačilo fakture-dobavnice 12345',
    });
  });
});