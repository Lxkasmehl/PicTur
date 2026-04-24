import { useMemo, useState } from 'react';
import { Paper, Stack, Group, Text, Select, Image, Modal, Box, Badge } from '@mantine/core';
import { getImageUrl } from '../services/api';
import type {
  TurtleImageAdditional,
  TurtleLooseImage,
  TurtleLooseSource,
  TurtlePrimaryInfo,
} from '../services/api';

interface OldTurtlePhotosSectionProps {
  /** All dates (YYYY-MM-DD) for which this turtle has photos. */
  historyDates: string[];
  /** Additional photos (microhabitat / condition / etc) — have timestamps. */
  additional: TurtleImageAdditional[];
  /** Structured loose photos (old references + other plastrons/carapaces + legacy). */
  loose: TurtleLooseImage[];
  /** Active plastron reference — shown under its capture/upload date. */
  primaryInfo?: TurtlePrimaryInfo | null;
  /** Active carapace reference — shown under its capture/upload date. */
  primaryCarapaceInfo?: TurtlePrimaryInfo | null;
}

const LOOSE_SOURCE_LABELS: Record<TurtleLooseSource, string> = {
  plastron_old_ref: 'Old Plastron Ref',
  plastron_other: 'Other Plastron',
  carapace_old_ref: 'Old Carapace Ref',
  carapace_other: 'Other Carapace',
  loose_legacy: 'Loose (legacy)',
};

// Category keys are stable strings. The category dropdown is assembled from
// fixed category keys plus any additional.type values actually present in the
// response, so new photo types main adds (left / right / back / etc.) show up
// automatically without code changes here.
const CAT_ALL = '__all__';
const CAT_REFERENCE = '__reference__';
const CAT_PLASTRON_OLD_REF = 'plastron_old_ref';
const CAT_PLASTRON_OTHER = 'plastron_other';
const CAT_CARAPACE_OLD_REF = 'carapace_old_ref';
const CAT_CARAPACE_OTHER = 'carapace_other';
const CAT_LOOSE_LEGACY = 'loose_legacy';

const DATE_ALL_EXIF_DESC = '__date_all_exif_desc__';
const DATE_ALL_EXIF_ASC = '__date_all_exif_asc__';
const DATE_ALL_UPLOAD_DESC = '__date_all_upload_desc__';
const DATE_ALL_UPLOAD_ASC = '__date_all_upload_asc__';

const DATE_ALL_VALUES = new Set<string>([
  DATE_ALL_EXIF_DESC,
  DATE_ALL_EXIF_ASC,
  DATE_ALL_UPLOAD_DESC,
  DATE_ALL_UPLOAD_ASC,
]);

interface HistoryPhoto {
  path: string;
  label: string;
  /** Stable category key for filtering (e.g. 'microhabitat', 'plastron_other'). */
  category: string;
  exifDate?: string | null;
  uploadDate?: string | null;
}

export function OldTurtlePhotosSection({
  historyDates,
  additional,
  loose,
  primaryInfo,
  primaryCarapaceInfo,
}: OldTurtlePhotosSectionProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(historyDates[0] ?? null);
  const [selectedCategory, setSelectedCategory] = useState<string>(CAT_ALL);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);

  // Collect every photo once with a stable category key. Keeps filter and
  // sort logic uniform across the two dropdowns and guards against ever
  // mixing in another turtle's data — only props from THIS turtle feed in.
  const allPhotos: HistoryPhoto[] = useMemo(() => {
    const out: HistoryPhoto[] = [];
    if (primaryInfo) {
      out.push({
        path: primaryInfo.path,
        label: 'Plastron (active)',
        category: CAT_REFERENCE,
        exifDate: primaryInfo.exif_date,
        uploadDate: primaryInfo.upload_date,
      });
    }
    if (primaryCarapaceInfo) {
      out.push({
        path: primaryCarapaceInfo.path,
        label: 'Carapace (active)',
        category: CAT_REFERENCE,
        exifDate: primaryCarapaceInfo.exif_date,
        uploadDate: primaryCarapaceInfo.upload_date,
      });
    }
    for (const a of additional) {
      out.push({
        path: a.path,
        label: a.type || 'additional',
        category: a.type || 'additional',
        exifDate: a.exif_date,
        uploadDate: a.upload_date,
      });
    }
    for (const l of loose) {
      out.push({
        path: l.path,
        label: LOOSE_SOURCE_LABELS[l.source] ?? l.source,
        category: l.source,
        exifDate: l.exif_date,
        uploadDate: l.upload_date,
      });
    }
    // De-dupe by path so primary and loose pointing at the same file don't double-render.
    const seen = new Set<string>();
    return out.filter((p) => (seen.has(p.path) ? false : (seen.add(p.path), true)));
  }, [additional, loose, primaryInfo, primaryCarapaceInfo]);

  // Build category dropdown from the actual data — fixed keys first, then any
  // additional types present in the response (sorted alphabetically).
  const categoryOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [
      { value: CAT_ALL, label: 'All categories' },
    ];

    const hasReference = allPhotos.some((p) => p.category === CAT_REFERENCE);
    if (hasReference) opts.push({ value: CAT_REFERENCE, label: 'Reference (active plastron + carapace)' });

    const looseCats: Array<{ key: string; label: string }> = [
      { key: CAT_PLASTRON_OLD_REF, label: 'Old Plastron References' },
      { key: CAT_PLASTRON_OTHER, label: 'Other Plastrons' },
      { key: CAT_CARAPACE_OLD_REF, label: 'Old Carapace References' },
      { key: CAT_CARAPACE_OTHER, label: 'Other Carapaces' },
      { key: CAT_LOOSE_LEGACY, label: 'Legacy loose' },
    ];
    for (const { key, label } of looseCats) {
      if (allPhotos.some((p) => p.category === key)) {
        opts.push({ value: key, label });
      }
    }

    // Additional.type values — anything not already covered above. This is
    // where microhabitat / condition / additional / future main types
    // (left, right, back, ...) surface automatically.
    const knownKeys = new Set<string>([
      CAT_REFERENCE, CAT_PLASTRON_OLD_REF, CAT_PLASTRON_OTHER,
      CAT_CARAPACE_OLD_REF, CAT_CARAPACE_OTHER, CAT_LOOSE_LEGACY,
    ]);
    const additionalTypes = new Set<string>();
    for (const p of allPhotos) {
      if (!knownKeys.has(p.category)) additionalTypes.add(p.category);
    }
    for (const t of Array.from(additionalTypes).sort()) {
      // Capitalize first letter for display only; value stays the raw type.
      const label = t.length > 0 ? t[0].toUpperCase() + t.slice(1) : t;
      opts.push({ value: t, label });
    }

    return opts;
  }, [allPhotos]);

  const dateOptions = useMemo(() => [
    { value: DATE_ALL_EXIF_DESC, label: 'All photos — newest EXIF first' },
    { value: DATE_ALL_EXIF_ASC, label: 'All photos — oldest EXIF first' },
    { value: DATE_ALL_UPLOAD_DESC, label: 'All photos — newest upload first' },
    { value: DATE_ALL_UPLOAD_ASC, label: 'All photos — oldest upload first' },
    ...historyDates.map((d) => ({ value: d, label: d })),
  ], [historyDates]);

  const visiblePhotos: HistoryPhoto[] = useMemo(() => {
    if (!selectedDate) return [];

    // Step 1: narrow by date mode.
    let byDate: HistoryPhoto[];
    if (DATE_ALL_VALUES.has(selectedDate)) {
      const field: 'exifDate' | 'uploadDate' =
        selectedDate === DATE_ALL_EXIF_DESC || selectedDate === DATE_ALL_EXIF_ASC
          ? 'exifDate'
          : 'uploadDate';
      const ascending = selectedDate === DATE_ALL_EXIF_ASC || selectedDate === DATE_ALL_UPLOAD_ASC;
      byDate = [...allPhotos].sort((a, b) => {
        const av = (a[field] || '').slice(0, 10);
        const bv = (b[field] || '').slice(0, 10);
        if (av === bv) return 0;
        if (!av) return 1;  // missing values always to the bottom
        if (!bv) return -1;
        if (ascending) return av < bv ? -1 : 1;
        return av < bv ? 1 : -1;
      });
    } else {
      // Specific date — use backend-matching canonical date precedence so each
      // photo appears under exactly one date.
      const canonicalDate = (p: HistoryPhoto): string => {
        const exif = (p.exifDate || '').slice(0, 10);
        if (exif) return exif;
        const upload = (p.uploadDate || '').slice(0, 10);
        if (upload) return upload;
        const pathMatch = p.path.match(/additional_images[/\\](\d{4}-\d{2}-\d{2})[/\\]/);
        return pathMatch?.[1] ?? '';
      };
      byDate = allPhotos.filter((p) => canonicalDate(p) === selectedDate);
    }

    // Step 2: narrow by category.
    if (selectedCategory === CAT_ALL) return byDate;
    return byDate.filter((p) => p.category === selectedCategory);
  }, [selectedDate, selectedCategory, allPhotos]);

  const formatDateSubtitle = (p: HistoryPhoto): string => {
    const exif = p.exifDate ? p.exifDate.slice(0, 10) : null;
    const upload = p.uploadDate ? p.uploadDate.slice(0, 10) : null;
    if (exif && upload && exif !== upload) return `📷 ${exif} · 📤 ${upload}`;
    if (exif) return `📷 ${exif}`;
    if (upload) return `📤 ${upload}`;
    return '';
  };

  if (historyDates.length === 0) return null;

  return (
    <Paper shadow='sm' p='md' radius='md' withBorder>
      <Stack gap='sm'>
        <Group justify='space-between' align='center' wrap='wrap'>
          <Text fw={600} size='sm'>
            View Old Turtle Photos
          </Text>
          <Group gap='xs' wrap='wrap'>
            <Select
              data={dateOptions}
              value={selectedDate}
              onChange={setSelectedDate}
              placeholder='Select a date'
              size='xs'
              allowDeselect={false}
              maw={260}
            />
            <Select
              data={categoryOptions}
              value={selectedCategory}
              onChange={(v) => setSelectedCategory(v ?? CAT_ALL)}
              placeholder='Category'
              size='xs'
              allowDeselect={false}
              maw={240}
            />
          </Group>
        </Group>
        {visiblePhotos.length === 0 ? (
          <Text size='xs' c='dimmed'>
            No photos match this filter.
          </Text>
        ) : (
          <Group gap='xs' wrap='wrap'>
            {visiblePhotos.map((p) => {
              const subtitle = formatDateSubtitle(p);
              return (
                <Stack key={p.path} gap={2} align='center' maw={120}>
                  <Box
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid var(--mantine-color-default-border)',
                      cursor: 'pointer',
                    }}
                    onClick={() => setLightboxPath(p.path)}
                  >
                    <Image src={getImageUrl(p.path)} alt={p.label} w={96} h={96} fit='cover' />
                  </Box>
                  <Badge size='xs' variant='light'>
                    {p.label}
                  </Badge>
                  {subtitle && (
                    <Text size='10px' c='dimmed' ta='center' lh={1.2}>
                      {subtitle}
                    </Text>
                  )}
                </Stack>
              );
            })}
          </Group>
        )}
      </Stack>

      <Modal
        opened={!!lightboxPath}
        onClose={() => setLightboxPath(null)}
        size='lg'
        title='Historical photo'
        centered
      >
        {lightboxPath && (
          <Image
            src={getImageUrl(lightboxPath)}
            alt='Full size'
            fit='contain'
            style={{ maxHeight: '80vh' }}
          />
        )}
      </Modal>
    </Paper>
  );
}
