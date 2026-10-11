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
