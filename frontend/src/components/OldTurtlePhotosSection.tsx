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

interface HistoryPhoto {
  path: string;
  label: string;
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
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);

  const photosForDate: HistoryPhoto[] = useMemo(() => {
    if (!selectedDate) return [];
    const out: HistoryPhoto[] = [];
    const matchesSelected = (info: TurtlePrimaryInfo) => {
      const ts = (info.timestamp || '').slice(0, 10);
      const exif = (info.exif_date || '').slice(0, 10);
      const upload = (info.upload_date || '').slice(0, 10);
      return ts === selectedDate || exif === selectedDate || upload === selectedDate;
    };
    if (primaryInfo && matchesSelected(primaryInfo)) {
      out.push({
        path: primaryInfo.path,
        label: 'Plastron (active)',
        exifDate: primaryInfo.exif_date,
        uploadDate: primaryInfo.upload_date,
      });
    }
    if (primaryCarapaceInfo && matchesSelected(primaryCarapaceInfo)) {
      out.push({
        path: primaryCarapaceInfo.path,
        label: 'Carapace (active)',
        exifDate: primaryCarapaceInfo.exif_date,
        uploadDate: primaryCarapaceInfo.upload_date,
      });
    }
    for (const a of additional) {
      const ts = (a.timestamp || '').slice(0, 10);
      const exif = (a.exif_date || '').slice(0, 10);
      const upload = (a.upload_date || '').slice(0, 10);
      const pathDateMatch = a.path.match(/additional_images[/\\](\d{4}-\d{2}-\d{2})[/\\]/);
      const folderDate = pathDateMatch?.[1] ?? '';
      if (ts === selectedDate || exif === selectedDate || upload === selectedDate || folderDate === selectedDate) {
        out.push({
          path: a.path,
          label: a.type || 'additional',
          exifDate: a.exif_date,
          uploadDate: a.upload_date,
        });
      }
    }
    for (const l of loose) {
      const ts = (l.timestamp || '').slice(0, 10);
      const exif = (l.exif_date || '').slice(0, 10);
      const upload = (l.upload_date || '').slice(0, 10);
      if (ts === selectedDate || exif === selectedDate || upload === selectedDate) {
        out.push({
          path: l.path,
          label: LOOSE_SOURCE_LABELS[l.source] ?? l.source,
          exifDate: l.exif_date,
          uploadDate: l.upload_date,
        });
      }
    }
    return out;
  }, [selectedDate, additional, loose, primaryInfo, primaryCarapaceInfo]);

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
          <Select
            data={historyDates}
            value={selectedDate}
            onChange={setSelectedDate}
            placeholder='Select a date'
            size='xs'
            allowDeselect={false}
            maw={220}
          />
        </Group>
        {photosForDate.length === 0 ? (
          <Text size='xs' c='dimmed'>
            No photos for this date.
          </Text>
        ) : (
          <Group gap='xs' wrap='wrap'>
            {photosForDate.map((p) => {
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
