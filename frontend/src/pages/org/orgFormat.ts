/** Display helpers shared by the research-group pages. */

export const SUBMISSION_STATUS = {
  pending: { label: 'In review', color: 'yellow' },
  approved: { label: 'Identified', color: 'green' },
  rejected: { label: 'Not used', color: 'gray' },
} as const;

export const TURTLE_STATUS = {
  active: { label: 'Active', color: 'green' },
  deceased: { label: 'Deceased', color: 'gray' },
  released: { label: 'Released', color: 'blue' },
} as const;

export const SEX_OPTIONS = [
  { value: 'F', label: 'Female' },
  { value: 'M', label: 'Male' },
  { value: 'U', label: 'Unknown' },
];

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'released', label: 'Released' },
  { value: 'deceased', label: 'Deceased' },
];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
