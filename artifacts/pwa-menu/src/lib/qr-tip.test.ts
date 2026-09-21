import { describe, expect, it } from 'vitest';
import {
  calculateQrOrderTotal,
  calculateQrReviewTotal,
  formatQrTipInput,
  parseQrTipInput,
} from './qr-tip';

describe('QR napitnina na zaključnem pregledu', () => {
  it('sprejme ničelni in poljuben decimalni znesek z vejico ali piko', () => {
    expect(parseQrTipInput('')).toBe(0);
    expect(parseQrTipInput('0')).toBe(0);
    expect(parseQrTipInput('1,25')).toBe(1.25);
    expect(parseQrTipInput('17.4')).toBe(17.4);
  });

  it('zavrne negativne vrednosti, besedilo in več kot dve decimalki', () => {
    expect(parseQrTipInput('-1')).toBeNull();
    expect(parseQrTipInput('napitnina')).toBeNull();
    expect(parseQrTipInput('1,234')).toBeNull();
  });

  it('prikaže slovenski vnos in zaokrožen končni seštevek', () => {
    expect(formatQrTipInput(2.4)).toBe('2,40');
    expect(calculateQrOrderTotal(11.2, 2.4)).toBe(13.6);
  });

  it('pri dopolnitvi prikaže celotno odprto naročilo, novo košarico in prepisano napitnino', () => {
    expect(calculateQrReviewTotal(7, 3.5, 1.25)).toBe(11.75);
    expect(calculateQrReviewTotal(0, 3.5, 1.25)).toBe(4.75);
  });
});