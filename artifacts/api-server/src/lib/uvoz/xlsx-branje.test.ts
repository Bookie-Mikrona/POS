import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  XlsxBranjeNapaka,
  preberiXlsxMatriko,
  preberiXlsxObjekte,
  preberiXlsxTipizirano,
  xlsxMatrikaZaStevilskeStolpce,
} from './xlsx-branje';
import { vDecimal } from './parser-csv';

const fixture = (ime: string) =>
  readFileSync(resolve(process.cwd(), '../../tests/uvoz-prejemnic/fixtures', ime));

describe('ExcelJS XLSX bralni adapter', () => {
  it('posnema header:1/raw:false/defval/blankrows in bere cached rezultat formule', async () => {
    const rows = await preberiXlsxMatriko(fixture('cenik-karakterizacija.xlsx'), ' Cenik ');

    expect(rows[3]).toEqual([
      'A-001',
      '00000000000000',
      'Čaj vrečka',
      'KOM',
      '20',
      '5.476',
      '9,5',
    ]);
    expect(rows[4]).toEqual(['', '', '', '', '', '', '']);
  });

  it('typed kanal prepusti native formula rezultat samo izbranim številskim stolpcem', async () => {
    const celice = await preberiXlsxTipizirano(fixture('cenik-karakterizacija.xlsx'), 'Cenik');
    const vrednosti = xlsxMatrikaZaStevilskeStolpce(celice, [4, 5, 6]);

    expect(celice[3]?.[1]).toMatchObject({
      text: '00000000000000',
      value: '00000000000000',
    });
    expect(celice[3]?.[5]).toMatchObject({
      text: '5.476',
      value: 5.476,
    });
    expect(vrednosti[3]).toEqual([
      'A-001',
      '00000000000000',
      'Čaj vrečka',
      'KOM',
      '20',
      5.476,
      '9,5',
    ]);
    expect(vrednosti[4]).toEqual(['', '', '', '', '', '', '']);
  });

  it('ohrani slovensko besedilno in native številčno parsanje', () => {
    expect(vDecimal('21.907,86', ',').toString()).toBe('21907.86');
    expect(vDecimal('5,476', ',').toString()).toBe('5.476');
    expect(vDecimal(5.476, ',').toString()).toBe('5.476');
    expect(vDecimal(20, ',').toString()).toBe('20');
    expect(vDecimal(-19.9, ',').toString()).toBe('-19.9');
    expect(vDecimal('', ',').toString()).toBe('0');
  });

  it('normalizira ime lista, podpira izrecni fallback in napačen list vrne ZAJ010', async () => {
    const raw = fixture('cenik-karakterizacija.xlsx');

    const fallback = await preberiXlsxMatriko(raw, 'Neobstojec_list', 1);
    expect(fallback[0]?.[0]).toBe('Cenik karakterizacija');

    await expect(preberiXlsxMatriko(raw, 'Neobstojec_list')).rejects.toMatchObject({
      koda: 'ZAJ010',
      naVoljo: ['Ignore', 'Cenik'],
    } satisfies Partial<XlsxBranjeNapaka>);
  });

  it('posnema SheetJS oblikovan datum in jasno zavrne stari binarni .xls', async () => {
    const os = await preberiXlsxMatriko(fixture('os-karakterizacija.xlsx'), 'Sredstva');
    expect(os[1]?.[7]).toBe('1/15/24');

    await expect(
      preberiXlsxMatriko(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).rejects.toMatchObject({
      koda: 'ZAJ018',
      message: 'Format .xls ni podprt — shranite datoteko kot .xlsx.',
    } satisfies Partial<XlsxBranjeNapaka>);
  });

  it('pretvori raw:false matriko v SheetJS-združljive object-mode vrstice', async () => {
    const rows = await preberiXlsxObjekte(
      fixture('os-obogatitev-karakterizacija.xlsx'),
      'Sredstva',
      0,
    );

    expect(rows).toEqual([
      {
        inventarna: 'OS-001',
        stm: 'STM-1',
        konto_popravka: '0400',
        konto_stroska: '4300',
        partner_davcna: '12345678',
        partner_naziv: 'Dobavitelj d.o.o.',
      },
      {
        inventarna: 'OS-002',
        stm: '',
        konto_popravka: '',
        konto_stroska: '',
        partner_davcna: '',
        partner_naziv: '',
      },
    ]);
  });
});