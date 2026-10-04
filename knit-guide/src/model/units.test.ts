import { describe, expect, it } from 'vitest';
import { inchesToCm, toMetric } from './units';

describe('metric guide', () => {
  it('converts the examples from the brief', () => {
    expect(toMetric('Work until piece measures 12 inches.').text).toBe('Work until piece measures 30.5 cm.');
    expect(toMetric('Finished chest: 44 inches.').text).toBe('Finished chest: 112 cm.');
    expect(toMetric('US 6 needles.').text).toBe('4 mm needles.');
    expect(toMetric('219 yards / 100 g.').text).toBe('200 m / 100 g.');
  });
  it('uses the designer metric value when both are given (no recalculation, no clutter)', () => {
    expect(toMetric('Chest: 44 inches (110 cm)').text).toBe('Chest: 110 cm');
    expect(toMetric('Chest: 110 cm = 44"').text).toBe('Chest: 110 cm');
    expect(toMetric('16 sts x 21 rows = 4" x 4" (10 cm x 10 cm) in lace pattern').text).toBe('16 sts x 21 rows = 10 cm x 10 cm in lace pattern');
    expect(toMetric('10 x 10 cm / 4" x 4"').text).toBe('10 x 10 cm');
    expect(toMetric('circular US 6 (4.0 mm)').text).toBe('circular 4 mm');
    expect(toMetric('size 3.5 mm / US 4 - or size needed').text).toBe('size 3.5 mm - or size needed');
    expect(toMetric('SIZE 5 MM = US 8: Length 40 cm = 16" and 80 cm = 32".').text).toBe('SIZE 5 mm: Length 40 cm and 80 cm.');
    expect(toMetric('219 yards (200 meters) / 100 gr').text).toBe('200 m / 100 g');
    expect(toMetric('8, 16, 24 and 32 cm / 3 ", 6¼", 9½"and 12½" .').text).toBe('8, 16, 24 and 32 cm.');
  });
  it('rounds sensibly', () => {
    expect(inchesToCm(12)).toBe(30.5);
    expect(inchesToCm(1.5)).toBe(3.8);
    expect(inchesToCm(6.75)).toBe(17);
  });
  it('does not touch ordinary words or stitch notation', () => {
    expect(toMetric('k2, yo, ssk in the round, 1x1 rib').text).toBe('k2, yo, ssk in the round, 1x1 rib');
  });
  it('flags a material disagreement and does not pick a side', () => {
    const r = toMetric('Chest: 44 inches (90 cm)');
    expect(r.flags).toHaveLength(1);
    expect(toMetric('Chest: 44 inches (110 cm)').flags).toHaveLength(0);
    expect(toMetric('Chest: 36 inches (90 cm)').flags).toHaveLength(0); // 91.4 vs 90 is rounding, not an error
  });
});

describe('fractions', () => {
  it('keeps the designer metric when it has a fraction, and drops lone-fraction inches', () => {
    expect(toMetric('approx. 8½ cm = 3¼" between each one').text).toBe('approx. 8½ cm between each one');
    expect(toMetric('The first buttonhole is worked 1 cm = ⅜" after the last increase.').text).toBe('The first buttonhole is worked 1 cm after the last increase.');
    expect(toMetric('every 2½ cm = 1" a total of 9 times').text).toBe('every 2½ cm a total of 9 times');
  });
});
