import { describe, expect, it } from 'vitest';
import { formatEur, formatTableLabel } from './format';

describe('formatEur', () => {
  it('uporablja decimalno vejico in presledek pred €', () => {
    expect(formatEur(15)).toBe('15,00 €');
    expect(formatEur(13.5)).toBe('13,50 €');
    expect(formatEur(0)).toBe('0,00 €');
    expect(formatEur(1234.5)).toBe('1.234,50 €');
    expect(formatEur(-2.5)).toBe('-2,50 €');
  });
});

describe('formatTableLabel', () => {
  it('doda predpono Miza le, če je ime ne vsebuje', () => {
    expect(formatTableLabel('Miza 7', 7)).toBe('Miza 7');
    expect(formatTableLabel('miza 7', 7)).toBe('miza 7');
    expect(formatTableLabel('Ob oknu', 3)).toBe('Miza Ob oknu');
    expect(formatTableLabel(null, 5)).toBe('Miza 5');
    expect(formatTableLabel('Mizarska 2', 2)).toBe('Miza Mizarska 2');
  });
});
