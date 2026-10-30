/** Money is stored as integer paise (₹1 = 100 paise). No floating point in the ledger. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(paise: number | null | undefined): string {
  return inr.format((paise ?? 0) / 100);
}

/** Parse a rupee amount typed by a person ("250", "250.5", "1,250.00") into paise. Returns null if invalid. */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = String(input ?? '').trim().replace(/[₹,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  return (paise / 100).toFixed(2);
}
