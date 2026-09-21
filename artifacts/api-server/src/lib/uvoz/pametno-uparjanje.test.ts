import { beforeEach, describe, expect, it, vi } from 'vitest';

const anthropicCreate = vi.hoisted(() => vi.fn());
vi.mock('@workspace/integrations-anthropic-ai', () => ({
  anthropic: { messages: { create: anthropicCreate } },
}));

import {
  normalizirajNazivZaUparjanje,
  podobnostNormaliziranihNazivov,
  predlagajUparjanjeZAi,
} from './pametno-uparjanje';

const kandidati = [{
  artikelId: 101,
  sifra: null,
  naziv: 'Pivo Union svetlo 5dl stek',
  osnovnaEnota: 'KOS',
  zadnjaCenaEnota: null,
  enotVPaketu: null,
  ocena: 0.45,
  znanDobavitelj: false,
  aktiven: true,
}];

describe('pametna normalizacija nazivov za uparjanje', () => {
  beforeEach(() => {
    anthropicCreate.mockReset();
  });

  it('poenoti litre, decilitre in okrajšavo steklenice', () => {
    expect(normalizirajNazivZaUparjanje('pivo union svetlo 0,5l stv'))
      .toBe('pivo union svetlo 500ml steklenica');
    expect(normalizirajNazivZaUparjanje('Pivo Union svetlo 5dl stek'))
      .toBe('pivo union svetlo 500ml steklenica');
  });

  it('ustvari enak trajni ključ za različna zapisa istega piva', () => {
    const prviUvoz = normalizirajNazivZaUparjanje('pivo union svetlo 0,5l stv');
    const ponovniUvoz = normalizirajNazivZaUparjanje('Pivo Union svetlo 5dl stek');
    expect(ponovniUvoz).toBe(prviUvoz);
  });

  it('različna zapisa istega artikla oceni kot popolno ujemanje', () => {
    expect(podobnostNormaliziranihNazivov(
      'pivo union svetlo 0,5l stv',
      'Pivo Union svetlo 5dl stek',
    )).toBe(1);
  });

  it('ne izenači različnih prostornin', () => {
    expect(podobnostNormaliziranihNazivov(
      'Pivo Union svetlo 0,5 l',
      'Pivo Union svetlo 0,33 l',
    )).toBeLessThan(1);
  });

  it('ob timeoutu AI vrne varen fallback brez prekinitve uvoza', async () => {
    anthropicCreate.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    await expect(predlagajUparjanjeZAi('pivo union svetlo 0,5l stv', kandidati))
      .resolves.toBeNull();
  });

  it('zavrne modelski ID, ki ni bil med dovoljenimi kandidati', async () => {
    anthropicCreate.mockResolvedValueOnce({
      content: [{
        type: 'tool_use',
        input: { artikelId: 999, zaupanje: 0.99, razlog: 'Nedovoljen ID' },
      }],
    });
    await expect(predlagajUparjanjeZAi('pivo union svetlo 0,5l stv', kandidati))
      .resolves.toBeNull();
  });
});