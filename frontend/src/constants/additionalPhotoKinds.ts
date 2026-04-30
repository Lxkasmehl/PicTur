export const ADDITIONAL_PHOTO_KINDS = [
  'carapace',
  'plastron',
  'anterior',
  'posterior',
  'left-side',
  'right-side',
  'people',
  'microhabitat',
  'condition',
  'injury',
  'other',
] as const;

export type AdditionalPhotoKind = (typeof ADDITIONAL_PHOTO_KINDS)[number];

export const ADDITIONAL_PHOTO_KIND_LABELS: Record<AdditionalPhotoKind, string> = {
  carapace: 'Carapace',
  plastron: 'Plastron',
  anterior: 'Anterior',
  posterior: 'Posterior',
  'left-side': 'Left side',
  'right-side': 'Right side',
  people: 'People',
  microhabitat: 'Microhabitat',
  condition: 'Condition',
  injury: 'Injury',
  other: 'Other',
};

export const ADDITIONAL_PHOTO_KIND_OPTIONS = ADDITIONAL_PHOTO_KINDS.map((value) => ({
  value,
  label: ADDITIONAL_PHOTO_KIND_LABELS[value],
}));

export function normalizeAdditionalPhotoKind(raw: string): AdditionalPhotoKind {
  const key = (raw || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  // Legacy aliases: treat head/tail as anterior/posterior.
  if (key === 'head') return 'anterior';
  if (key === 'tail') return 'posterior';
  if (
    key === 'carapace' ||
    key === 'plastron' ||
    key === 'anterior' ||
    key === 'posterior' ||
    key === 'left-side' ||
    key === 'right-side' ||
    key === 'people' ||
    key === 'microhabitat' ||
    key === 'condition' ||
    key === 'injury' ||
    key === 'other'
  ) {
    return key;
  }
  return 'other';
}

export function additionalPhotoKindLabel(kind: string): string {
  const normalized = normalizeAdditionalPhotoKind(kind);
  return ADDITIONAL_PHOTO_KIND_LABELS[normalized];
}
