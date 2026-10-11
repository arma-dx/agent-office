import { describe, expect, it } from 'vitest';
import {
  amountInputText,
  formatCount,
  formatMoney,
  limitAlreadyReached,
  parseAmountInput,
  remainingUsd,
  upToCentsUsd,
} from './money.ts';

describe('money as the panel writes and reads it', () => {
  it('an amount is read the Turkish way', () => {
    expect(parseAmountInput('1250,5', 12)).toBe('1250.5');
    expect(parseAmountInput('1.250,50', 12)).toBe('1250.50');
    expect(parseAmountInput('125000', 12)).toBe('125000');
    expect(parseAmountInput(' 125.000,50 ', 12)).toBe('125000.50');
    expect(parseAmountInput('0,5', 12)).toBe('0.5');
    // Zeros in front are dropped; they are not digits of the amount.
    expect(parseAmountInput('007', 1)).toBe('7');
    // A dot is never the decimal sign, and groups are of three: "12.5" is neither 12,5 nor 125.
    for (const refused of ['12.5', '1,234', '1.25,0', '1.2345', 'abc', '', '   ', '-5', '1e3']) {
      expect(parseAmountInput(refused, 12), refused).toBeNull();
    }
    // Zero is not an amount.
    expect(parseAmountInput('0', 12)).toBeNull();
    expect(parseAmountInput('0,00', 12)).toBeNull();
    // More whole digits than the field holds.
    expect(parseAmountInput('999999999999', 12)).toBe('999999999999');
    expect(parseAmountInput('1.000.000.000.000', 12)).toBeNull();
    expect(parseAmountInput('999999,99', 6)).toBe('999999.99');
    expect(parseAmountInput('1000000', 6)).toBeNull();
  });

  it('a saved amount opens a form as a person would type it, and is read back the same', () => {
    expect(amountInputText('125000.50')).toBe('125.000,50');
    expect(amountInputText('999.00')).toBe('999,00');
    expect(amountInputText('1250')).toBe('1.250');
    expect(amountInputText('999999999999.99')).toBe('999.999.999.999,99');
    for (const amount of ['125000.50', '0.05', '7', '1000000.5']) {
      expect(parseAmountInput(amountInputText(amount), 12)).toBe(amount);
    }
  });

  it('money is written with its sign and two decimals', () => {
    expect(formatMoney('150000', 'TRY')).toBe('₺150.000,00');
    expect(formatMoney('1.67469', 'USD')).toBe('$1,67');
    expect(formatMoney('2500000', 'EUR')).toBe('€2.500.000,00');
    // A single run costs fractions of a cent: four decimals where they are asked for.
    expect(formatMoney('0.012345', 'USD', 4)).toBe('$0,0123');
  });

  it('a count is written with dot groups', () => {
    expect(formatCount(6800)).toBe('6.800');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234567)).toBe('1.234.567');
  });

  it('what is left of a limit is exact and never below zero', () => {
    expect(remainingUsd('25.00', '1.674690')).toBe('23.325310');
    expect(remainingUsd('25', '25')).toBe('0.000000');
    // The sum can pass the limit by the calls that were in flight.
    expect(remainingUsd('25.00', '25.004100')).toBe('0.000000');
    expect(remainingUsd('999999.99', '0')).toBe('999999.990000');
    // Not a floating point subtraction: 0.3 - 0.1 is 0.2.
    expect(remainingUsd('0.3', '0.1')).toBe('0.200000');
    expect(formatMoney(remainingUsd('25.00', '1.674690'), 'USD')).toBe('$23,33');
  });

  it('what is left is shown rounded up to the cent: zero only when nothing is left', () => {
    expect(upToCentsUsd('0.000001')).toBe('0.01');
    expect(upToCentsUsd('0.004000')).toBe('0.01');
    expect(upToCentsUsd('0.010000')).toBe('0.01');
    expect(upToCentsUsd('0.010001')).toBe('0.02');
    expect(upToCentsUsd('0.000000')).toBe('0.00');
    expect(upToCentsUsd('0')).toBe('0.00');
    expect(upToCentsUsd('23.325310')).toBe('23.33');
    expect(upToCentsUsd('5')).toBe('5.00');
    expect(upToCentsUsd('999999.990000')).toBe('999999.99');
    // Half a cent below the limit: not reached, and not "nothing left".
    expect(formatMoney(upToCentsUsd(remainingUsd('5.00', '4.996000')), 'USD')).toBe('$0,01');
    // Reached, or passed by a call in flight: nothing left.
    expect(formatMoney(upToCentsUsd(remainingUsd('25.00', '25.004100')), 'USD')).toBe('$0,00');
    expect(formatMoney(upToCentsUsd(remainingUsd('25', '25')), 'USD')).toBe('$0,00');
  });

  it('a limit that is not above what was spent is reached at once', () => {
    expect(limitAlreadyReached('5.00', '5.000000')).toBe(true);
    expect(limitAlreadyReached('5', '5.000001')).toBe(true);
    expect(limitAlreadyReached('5.01', '5.009999')).toBe(false);
    expect(limitAlreadyReached('0.01', '0')).toBe(false);
  });
});
