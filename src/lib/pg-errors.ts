/** Helpers to recognise Postgres errors regardless of driver (pg or PGlite). */
export function pgCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

export function isUniqueViolation(e: unknown, indexName?: string): boolean {
  if (pgCode(e) !== '23505') return false;
  if (!indexName) return true;
  const x = e as { constraint?: string; message?: string };
  return x.constraint === indexName || String(x.message ?? '').includes(indexName);
}

export function messageHas(e: unknown, text: string): boolean {
  return String((e as { message?: string } | null)?.message ?? '').includes(text);
}
