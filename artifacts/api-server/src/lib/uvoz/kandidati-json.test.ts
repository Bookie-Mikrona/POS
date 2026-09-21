import { describe, expect, it } from 'vitest';
import { razcleniUparjanjeKandidate } from './kandidati-json';

describe('razcleniUparjanjeKandidate', () => {
  it('pretvori JSON-besedilo iz baze v seznam kandidatov', () => {
    expect(razcleniUparjanjeKandidate(
      '[{"artikelId":12600,"naziv":"Pivo union svetlo 0,33l stv","ocena":0.89}]',
    )).toEqual([{
      artikelId: 12600,
      naziv: 'Pivo union svetlo 0,33l stv',
      ocena: 0.89,
    }]);
  });

  it('ohrani že razčlenjeni seznam in varno zavrne pokvarjen zapis', () => {
    expect(razcleniUparjanjeKandidate([{ artikelId: 12600 }]))
      .toEqual([{ artikelId: 12600 }]);
    expect(razcleniUparjanjeKandidate('{pokvarjen json')).toEqual([]);
  });
});