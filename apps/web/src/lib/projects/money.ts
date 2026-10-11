import type { BudgetCurrency } from '@agent-office/shared';

/**
 * Money and counts as the panel writes them, and an amount as a person types it. Amounts travel
 * as text (the shared contract): nothing here rounds what is sent, only what is shown.
 */

/** "₺150.000,00", "$1,67", "€2.500.000,00": an amount as the panel writes it. */
export function formatMoney(amount: string, currency: BudgetCurrency, digits: 2 | 4 = 2): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(amount));
}

/** "6.800": a count of tokens. */
export function formatCount(count: number): string {
  return new Intl.NumberFormat('tr-TR').format(count);
}

/**
 * What a person typed as an amount, as the text the API takes ("1250.50"), or null when it is
 * not an amount. Turkish writing: the comma is the decimal sign; dots may group thousands
 * ("1.250,50") and are then in every third place; nothing else is accepted, so "12.5" is not
 * read as twelve and a half or as 125. Zero is not an amount.
 */
export function parseAmountInput(text: string, maxWholeDigits: number): string | null {
  const typed = text.trim();
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(typed)) return null;
  const [whole = '', decimals = ''] = typed.replaceAll('.', '').split(',');
  const digits = whole.replace(/^0+(?=\d)/, '');
  if (digits.length > maxWholeDigits) return null;
  const amount = decimals === '' ? digits : `${digits}.${decimals}`;
  return Number(amount) > 0 ? amount : null;
}

/**
 * A saved amount ("125000.50") as a person would type it ("125.000,50"): what a form opens with.
 * parseAmountInput reads it back to the same amount.
 */
export function amountInputText(amount: string): string {
  const [whole = '', decimals = ''] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals === '' ? grouped : `${grouped},${decimals}`;
}

/** A dollar amount with up to six decimals in millionths of a dollar: exact, whatever its size. */
function micros(amount: string): bigint {
  const [whole = '0', decimals = ''] = amount.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(decimals.padEnd(6, '0').slice(0, 6));
}

/**
 * What is left of a limit after what was spent, as a dollar amount with six decimals; never below
 * zero (the sum can pass the limit by the model calls that were in flight when it was reached).
 */
export function remainingUsd(limitUsd: string, spentUsd: string): string {
  const left = micros(limitUsd) - micros(spentUsd);
  const shown = left > 0n ? left : 0n;
  return `${String(shown / 1_000_000n)}.${String(shown % 1_000_000n).padStart(6, '0')}`;
}

/**
 * A limit that is not above what was spent is reached the moment it is saved. The two amounts are
 * compared exactly, never as floating point numbers.
 */
export function limitAlreadyReached(limitUsd: string, spentUsd: string): boolean {
  return micros(limitUsd) <= micros(spentUsd);
}
