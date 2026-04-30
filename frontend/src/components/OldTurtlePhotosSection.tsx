import { useEffect, useMemo, useState } from 'react';
import { Paper, Stack, Group, Text, Select, Image, Modal, Box, Badge, ActionIcon, TagsInput, Button } from '@mantine/core';
import { IconTrash, IconDownload, IconRestore, IconDeviceFloppy } from '@tabler/icons-react';
import { getImageUrl, getTurtleImageDownloadUrl } from '../services/api';
import type {
  TurtleDeletedImage,
  TurtleImageAdditional,
  TurtleLooseImage,
  TurtleLooseSource,
  TurtlePrimaryInfo,
} from '../services/api';
import { additionalPhotoKindLabel } from '../constants/additionalPhotoKinds';

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
  /** Soft-deleted images. When present + an onRestore callback is provided,
   *  a "Deleted photos (restorable)" option appears in the date dropdown. */
  deleted?: TurtleDeletedImage[];
  /** Callback when the user clicks the trash on a live photo. Parent owns the
   *  confirm-modal flow and refetch. Button hidden when not provided. */
  onDelete?: (photo: HistoryPhotoExternal) => void;
  /** Callback when the user clicks restore on a photo in the deleted view. */
  onRestore?: (photo: TurtleDeletedImage) => void;
  /** Callback to persist tag edits made in the lightbox. Parent calls the
   *  backend (PATCH /api/turtles/images/labels) and refreshes the turtle's
   *  images so the new labels appear under the thumbnails. The TagsInput
   *  editor in the lightbox is hidden when this prop is omitted. */
  onLabelsChange?: (path: string, labels: string[]) => Promise<void>;
}

/** Subset of HistoryPhoto exposed to the delete callback. Kept minimal so the
 *  parent isn't coupled to internal category keys. */
export interface HistoryPhotoExternal {
  path: string;
  label: string;
  category: string;
  exifDate?: string | null;
  uploadDate?: string | null;
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
const DATE_DELETED_ONLY = '__date_deleted_only__';

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
  /** Free-form tags from the additional-images manifest (e.g. 'burned',
   *  'injury'). Only present on additional photos today; loose photos and
   *  active references don't carry tags. */
  labels?: string[];
  exifDate?: string | null;
  uploadDate?: string | null;
  /** Epoch ms — finer-grained than uploadDate; used as the sort tiebreaker
   *  so multiple uploads on the same day order by actual time. Also used
   *  as the cache-bust ``v`` on active-reference image URLs. */
  uploadTs?: number | null;
  /** True for the active plastron / carapace reference. Path stays stable
   *  across replacements, so URLs need uploadTs as a cache-bust. */
  isActiveRef?: boolean;
}

export function OldTurtlePhotosSection({
  historyDates,
  additional,
  loose,
  primaryInfo,
  primaryCarapaceInfo,
  deleted,
  onDelete,
  onRestore,
  onLabelsChange,
}: OldTurtlePhotosSectionProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(historyDates[0] ?? null);
  const [selectedCategory, setSelectedCategory] = useState<string>(CAT_ALL);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Re-seed the tag editor whenever the lightbox opens on a different photo,
  // and whenever upstream data refreshes (e.g. after a successful save).
  // Looks up the current entry in additional/loose/primary streams so live
  // photos and the active references all use the same source of truth.
  useEffect(() => {
    if (!lightboxPath) {
      setEditingTags([]);
      return;
    }
    const fromAdditional = additional.find((a) => a.path === lightboxPath)?.labels;
    if (fromAdditional !== undefined) {
      setEditingTags(fromAdditional ?? []);
      return;
    }
    const fromLoose = loose.find((l) => l.path === lightboxPath)?.labels;
    if (fromLoose !== undefined) {
      setEditingTags(fromLoose ?? []);
      return;
    }
    if (primaryInfo?.path === lightboxPath) {
      setEditingTags(primaryInfo.labels ?? []);
      return;
    }
    if (primaryCarapaceInfo?.path === lightboxPath) {
      setEditingTags(primaryCarapaceInfo.labels ?? []);
      return;
    }
    setEditingTags([]);
  }, [lightboxPath, additional, loose, primaryInfo, primaryCarapaceInfo]);

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
        labels: primaryInfo.labels,
        exifDate: primaryInfo.exif_date,
        uploadDate: primaryInfo.upload_date,
        uploadTs: primaryInfo.upload_ts,
        isActiveRef: true,
      });
    }
    if (primaryCarapaceInfo) {
      out.push({
        path: primaryCarapaceInfo.path,
        label: 'Carapace (active)',
        category: CAT_REFERENCE,
        labels: primaryCarapaceInfo.labels,
        exifDate: primaryCarapaceInfo.exif_date,
        uploadDate: primaryCarapaceInfo.upload_date,
        uploadTs: primaryCarapaceInfo.upload_ts,
        isActiveRef: true,
      });
    }
    for (const a of additional) {
      const cat = a.type || 'other';
      out.push({
        path: a.path,
        // Pretty label (e.g. 'Left side' rather than the raw 'left-side')
        // — falls back to the helper for any canonical kind, including the
        // ones main expanded into (anterior / posterior / left-side /
        // right-side / people / injury).
        label: additionalPhotoKindLabel(cat),
        category: cat,
        labels: a.labels,
        exifDate: a.exif_date,
        uploadDate: a.upload_date,
        uploadTs: a.upload_ts,
      });
    }
    for (const l of loose) {
      out.push({
        path: l.path,
        label: LOOSE_SOURCE_LABELS[l.source] ?? l.source,
        category: l.source,
        labels: l.labels,
        exifDate: l.exif_date,
        uploadDate: l.upload_date,
        uploadTs: l.upload_ts,
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
    // where microhabitat / condition + the post-merge canonical kinds
    // (anterior / posterior / left-side / right-side / people / injury)
    // surface automatically.
    const knownKeys = new Set<string>([
      CAT_REFERENCE, CAT_PLASTRON_OLD_REF, CAT_PLASTRON_OTHER,
      CAT_CARAPACE_OLD_REF, CAT_CARAPACE_OTHER, CAT_LOOSE_LEGACY,
    ]);
    const additionalTypes = new Set<string>();
    for (const p of allPhotos) {
      if (!knownKeys.has(p.category)) additionalTypes.add(p.category);
    }
    for (const t of Array.from(additionalTypes).sort()) {
      // Use the canonical kind label so 'left-side' renders as 'Left side'
      // (not 'Left-side' from the old simple-capitalize fallback). Unknown
      // values fall through to 'Other'.
      opts.push({ value: t, label: additionalPhotoKindLabel(t) });
    }

    return opts;
  }, [allPhotos]);

  const dateOptions = useMemo(() => {
    const base = [
      { value: DATE_ALL_EXIF_DESC, label: 'All photos — newest EXIF first' },
      { value: DATE_ALL_EXIF_ASC, label: 'All photos — oldest EXIF first' },
      { value: DATE_ALL_UPLOAD_DESC, label: 'All photos — newest upload first' },
      { value: DATE_ALL_UPLOAD_ASC, label: 'All photos — oldest upload first' },
    ];
    const hasDeleted = (deleted?.length ?? 0) > 0 && !!onRestore;
    if (hasDeleted) {
      base.push({ value: DATE_DELETED_ONLY, label: `Deleted photos (restorable) — ${deleted!.length}` });
    }
    return [...base, ...historyDates.map((d) => ({ value: d, label: d }))];
  }, [historyDates, deleted, onRestore]);

  const visiblePhotos: HistoryPhoto[] = useMemo(() => {
    if (!selectedDate) return [];

    // Step 1: narrow by date mode.
    let byDate: HistoryPhoto[];
    if (DATE_ALL_VALUES.has(selectedDate)) {
      const useTs = selectedDate === DATE_ALL_UPLOAD_DESC || selectedDate === DATE_ALL_UPLOAD_ASC;
      const dateField: 'exifDate' | 'uploadDate' = useTs ? 'uploadDate' : 'exifDate';
      const ascending = selectedDate === DATE_ALL_EXIF_ASC || selectedDate === DATE_ALL_UPLOAD_ASC;
      byDate = [...allPhotos].sort((a, b) => {
        // In upload modes prefer the ms-resolution upload_ts as the primary
        // key — multiple uploads on the same day used to all tie on the
        // YYYY-MM-DD slice and fall back to array build order, which made
        // the active plastron+carapace+microhabitat+condition always sit
        // above 9 plastron archives uploaded seconds earlier.
        if (useTs) {
          const at = a.uploadTs;
          const bt = b.uploadTs;
          if (typeof at === 'number' && typeof bt === 'number' && at !== bt) {
            return ascending ? at - bt : bt - at;
          }
          if (typeof at === 'number' && typeof bt !== 'number') return -1;
          if (typeof at !== 'number' && typeof bt === 'number') return 1;
          // Both missing or equal → fall through to date-string compare.
        }
        const av = (a[dateField] || '').slice(0, 10);
        const bv = (b[dateField] || '').slice(0, 10);
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

  const inDeletedView = selectedDate === DATE_DELETED_ONLY;

  // Categorize deleted entries for display labels when in the deleted view.
  const deletedCategoryLabel = (cat: string): string => {
    switch (cat) {
      case 'reference': return 'Reference (deleted)';
      case 'plastron_old_ref': return 'Old Plastron Ref (deleted)';
      case 'plastron_other': return 'Other Plastron (deleted)';
      case 'carapace_old_ref': return 'Old Carapace Ref (deleted)';
      case 'carapace_other': return 'Other Carapace (deleted)';
      case 'additional': return 'Additional (deleted)';
      case 'loose_legacy': return 'Legacy loose (deleted)';
      default: return 'Deleted';
    }
  };

  const formatDeletedSubtitle = (p: TurtleDeletedImage): string => {
    const exif = p.exif_date ? p.exif_date.slice(0, 10) : null;
    const upload = p.upload_date ? p.upload_date.slice(0, 10) : null;
    if (exif && upload && exif !== upload) return `📷 ${exif} · 📤 ${upload}`;
    if (exif) return `📷 ${exif}`;
    if (upload) return `📤 ${upload}`;
    return '';
  };

  if (historyDates.length === 0 && (deleted?.length ?? 0) === 0) return null;

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
        {inDeletedView ? (
          (deleted?.length ?? 0) === 0 ? (
            <Text size='xs' c='dimmed'>No deleted photos.</Text>
          ) : (
            <Group gap='xs' wrap='wrap'>
              {deleted!.map((d) => {
                const subtitle = formatDeletedSubtitle(d);
                return (
                  <Stack key={d.path} gap={2} align='center' maw={120}>
                    <Box
                      style={{
                        width: 96,
                        height: 96,
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid var(--mantine-color-default-border)',
                        cursor: 'pointer',
                        opacity: 0.75,
                      }}
                      onClick={() => setLightboxPath(d.path)}
                    >
                      <Image src={getImageUrl(d.path)} alt={d.category} w={96} h={96} fit='cover' />
                    </Box>
                    <Badge size='xs' variant='light' color='gray'>
                      {deletedCategoryLabel(d.category)}
                    </Badge>
                    {subtitle && (
                      <Text size='10px' c='dimmed' ta='center' lh={1.2}>
                        {subtitle}
                      </Text>
                    )}
                    <Group gap={4} justify='center' wrap='nowrap'>
                      <ActionIcon
                        size='sm'
                        variant='subtle'
                        component='a'
                        href={getTurtleImageDownloadUrl(d.path)}
                        title='Download'
                        download
                      >
                        <IconDownload size={14} />
                      </ActionIcon>
                      {onRestore && (
                        <ActionIcon
                          size='sm'
                          variant='subtle'
                          color='green'
                          title='Restore'
                          onClick={() => onRestore(d)}
                        >
                          <IconRestore size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Stack>
                );
              })}
            </Group>
          )
        ) : visiblePhotos.length === 0 ? (
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
                    <Image
                      src={getImageUrl(p.path, p.isActiveRef ? p.uploadTs : null)}
                      alt={p.label}
                      w={96}
                      h={96}
                      fit='cover'
                    />
                  </Box>
                  <Badge size='xs' variant='light'>
                    {p.label}
                  </Badge>
                  {p.labels && p.labels.length > 0 && (
                    <Group gap={4} justify='center' wrap='wrap'>
                      {p.labels.map((tag) => (
                        <Badge key={tag} size='xs' variant='outline' color='gray'>
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  )}
                  {subtitle && (
                    <Text size='10px' c='dimmed' ta='center' lh={1.2}>
                      {subtitle}
                    </Text>
                  )}
                  <Group gap={4} justify='center' wrap='nowrap'>
                    <ActionIcon
                      size='sm'
                      variant='subtle'
                      component='a'
                      href={getTurtleImageDownloadUrl(p.path)}
                      title='Download'
                      download
                    >
                      <IconDownload size={14} />
                    </ActionIcon>
                    {onDelete && (
                      <ActionIcon
                        size='sm'
                        variant='subtle'
                        color='red'
                        title='Delete'
                        onClick={() => onDelete(p)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Group>
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
          <Stack gap='sm'>
            <Image
              src={getImageUrl(
                lightboxPath,
                primaryInfo?.path === lightboxPath
                  ? primaryInfo.upload_ts
                  : primaryCarapaceInfo?.path === lightboxPath
                    ? primaryCarapaceInfo.upload_ts
                    : null,
              )}
              alt='Full size'
              fit='contain'
              style={{ maxHeight: '70vh' }}
            />
            {onLabelsChange && (
              <Stack gap='xs'>
                <Text size='sm' fw={500}>Tags</Text>
                <TagsInput
                  value={editingTags}
                  onChange={setEditingTags}
                  placeholder='Add a tag and press Enter'
                  clearable
                  disabled={savingTags}
                />
                <Group justify='flex-end'>
                  <Button
                    size='xs'
                    leftSection={<IconDeviceFloppy size={14} />}
                    loading={savingTags}
                    onClick={async () => {
                      if (!lightboxPath) return;
                      setSavingTags(true);
                      try {
                        await onLabelsChange(lightboxPath, editingTags);
                      } finally {
                        setSavingTags(false);
                      }
                    }}
                  >
                    Save tags
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
