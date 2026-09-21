import { describe, expect, it } from 'vitest';
import { jeMismatchVelikosti, stevilkeIzNaziva } from './uparjanjeNaziv';

describe('primerjava nazivov pri OCR uparjanju', () => {
  it('varno obravnava manjkajoče nazive iz OCR-ja', () => {
    expect(stevilkeIzNaziva(undefined)).toEqual([]);
    expect(stevilkeIzNaziva(null)).toEqual([]);
    expect(jeMismatchVelikosti('Moka 1 kg', undefined)).toBe(false);
    expect(jeMismatchVelikosti(undefined, 'Moka 1 kg')).toBe(false);
  });

  it('še vedno opozori na različni velikosti pakiranja', () => {
    expect(jeMismatchVelikosti('Moka 1 kg', 'Moka 3,6 kg')).toBe(true);
    expect(jeMismatchVelikosti('Moka 1 kg', 'Moka 1 kg')).toBe(false);
  });
});