/** Locale date for ISO timestamps ('–' when missing or invalid). */
export function formatLocalDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
}
