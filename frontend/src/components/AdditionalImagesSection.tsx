import {
  Paper,
  Stack,
  Group,
  Text,
  Button,
  Image,
  Modal,
  Box,
  Badge,
  TagsInput,
  Select,
  Divider,
} from '@mantine/core';
import {
  IconPhotoPlus,
  IconTrash,
  IconZoomIn,
  IconUpload,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { getImageUrl } from '../services/api';
import { validateFile } from '../utils/fileValidation';
import {
  uploadReviewPacketAdditionalImages,
  removeReviewPacketAdditionalImage,
  uploadTurtleAdditionalImages,
  deleteTurtleAdditionalImage,
  setTurtleImageLabels,
} from '../services/api';
import { notifications } from '@mantine/notifications';

/**
 * Photo categories the section knows how to render.
 *
 * The bare ``plastron`` / ``carapace`` values are what staged uploads use
 * (the user picks "Plastron" or "Carapace" from the upload buttons). The
 * suffixed variants (``plastron_active``, ``plastron_old_ref``,
 * ``plastron_other``, and the carapace mirrors) come from the historical-
 * scratchpad use case where we want to distinguish:
 *  - the active SuperPoint reference (``plastron_active``),
 *  - a previously-active reference now archived (``plastron_old_ref``), and
 *  - any extra plastron not used as a reference (``plastron_other``).
 * Each gets its own section header so multiple plastron uploads in one day
 * stay grouped by role instead of collapsing into a single "Plastron
 * (additional)" pile.
 */
export type AdditionalPhotoKind =
  | 'microhabitat'
  | 'condition'
  | 'carapace'
  | 'plastron'
  | 'additional'
  | 'other'
  | 'plastron_active'
  | 'plastron_old_ref'
  | 'plastron_other'
  | 'carapace_active'
  | 'carapace_old_ref'
  | 'carapace_other'
  | 'loose_legacy';

/** Single additional image for display (packet or turtle). */
export interface AdditionalImageDisplay {
  imagePath: string;
  filename: string;
  type: string;
  labels?: string[];
  /** Epoch ms cache-bust for active references whose path stays stable
   *  across replacements. Omit for archived / unique-path images. */
  uploadTs?: number | null;
}

interface AdditionalImagesSectionProps {
  title?: string;
  images: AdditionalImageDisplay[];
  onRefresh: () => Promise<void>;
  requestId?: string;
  turtleId?: string;
  sheetName?: string | null;
  disabled?: boolean;
  embedded?: boolean;
  hideAddButtons?: boolean;
  /** When provided, ALL button clicks stage via this callback instead of uploading immediately.
   *  Parent owns the staged files and commits them on save. Plastron button becomes visible,
   *  and plastron/carapace are rendered in red to signal they may replace the current reference.
   *  Leave undefined for packet-mode / immediate-upload behavior. */
  onStagePhoto?: (type: 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional', file: File) => void;
  /** Override for the delete button. When provided, clicking trash calls this instead
   *  of the built-in handler, and it is the parent's responsibility to refetch. Used
   *  by scratchpad callers so the confirm-modal and soft-delete routing lives in one
   *  place instead of being duplicated here. */
  onDelete?: (photo: AdditionalImageDisplay) => Promise<void> | void;
}

// Active references first, then old refs, then "other" (extras), then the
// generic plastron/carapace staging kinds, then the additional-image kinds.
const TYPE_ORDER: AdditionalPhotoKind[] = [
  'plastron_active',
  'plastron_old_ref',
  'plastron_other',
  'carapace_active',
  'carapace_old_ref',
  'carapace_other',
  'carapace',
  'plastron',
  'microhabitat',
  'condition',
  'additional',
  'loose_legacy',
  'other',
];

const KIND_OPTIONS = [
  { value: 'carapace', label: 'Carapace' },
  { value: 'plastron', label: 'Plastron (additional)' },
  { value: 'microhabitat', label: 'Microhabitat' },
  { value: 'condition', label: 'Condition' },
  { value: 'additional', label: 'Additional' },
  { value: 'other', label: 'Other' },
] as const;

/** Turtle-record additional photos support plastron-extra in manifest; review packets use a narrower type set. */
const KIND_OPTIONS_REVIEW_PACKET = KIND_OPTIONS.filter((o) => o.value !== 'plastron');

function normalizeKind(t: string): AdditionalPhotoKind {
  const s = (t || 'other').toLowerCase();
  if (
    s === 'microhabitat' ||
    s === 'condition' ||
    s === 'carapace' ||
    s === 'plastron' ||
    s === 'additional' ||
    s === 'other' ||
    s === 'plastron_active' ||
    s === 'plastron_old_ref' ||
    s === 'plastron_other' ||
    s === 'carapace_active' ||
    s === 'carapace_old_ref' ||
    s === 'carapace_other' ||
    s === 'loose_legacy'
  )
    return s;
  return 'other';
}

function kindSectionLabel(k: AdditionalPhotoKind): string {
  if (k === 'other') return 'Other';
  if (k === 'plastron') return 'Plastron (additional)';
  if (k === 'additional') return 'Additional';
  if (k === 'plastron_active') return 'Plastron (active reference)';
  if (k === 'plastron_old_ref') return 'Plastron (old reference)';
  if (k === 'plastron_other') return 'Plastron (additional)';
  if (k === 'carapace_active') return 'Carapace (active reference)';
  if (k === 'carapace_old_ref') return 'Carapace (old reference)';
  if (k === 'carapace_other') return 'Carapace (additional)';
  if (k === 'loose_legacy') return 'Loose (legacy)';
  return k;
}

type StagedRow = {
  id: string;
  file: File;
  previewUrl: string;
  type: 'carapace' | 'plastron' | 'microhabitat' | 'condition' | 'additional' | 'other';
  labels: string[];
};

export function AdditionalImagesSection({
  title = 'Additional photos',
  images,
  onRefresh,
  requestId,
  turtleId,
  sheetName = null,
  disabled = false,
  embedded = false,
  hideAddButtons = false,
  onStagePhoto,
  onDelete,
}: AdditionalImagesSectionProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [inlineDraft, setInlineDraft] = useState<Record<string, string[]>>({});
  const [savingInline, setSavingInline] = useState<string | null>(null);

  const isPacket = !!requestId;
  const isTurtle = !!turtleId;
  const supportsPlastronExtra = !isPacket;
  const canEdit = (isPacket || isTurtle) && !disabled;
  const canEditLabels = isTurtle && !disabled;
  const stagingKindOptions = supportsPlastronExtra ? KIND_OPTIONS : KIND_OPTIONS_REVIEW_PACKET;

  useEffect(() => {
    return () => {
      staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
  }, [staged]);

  useEffect(() => {
    const next: Record<string, string[]> = {};
    images.forEach((img) => {
      next[img.filename] = [...(img.labels ?? [])];
    });
    setInlineDraft(next);
  }, [images]);

  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  useEffect(() => {
    return () => {
      stagedRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
  }, []);

  const openLightboxServer = (path: string, version?: number | string | null) => {
    setLightboxSrc(getImageUrl(path, version));
  };

  const openLightboxStaged = (url: string) => {
    setLightboxSrc(url);
  };

  const closeLightbox = () => {
    setLightboxSrc(null);
  };

  const handleRemoveWithOverride = async (img: AdditionalImageDisplay) => {
    if (onDelete) {
      // Parent owns the whole flow (confirm modal + refetch).
      setRemoving(img.filename);
      try {
        await onDelete(img);
      } finally {
        setRemoving(null);
      }
      return;
    }
    await handleRemove(img.filename);
  };

  const handleRemove = async (filename: string) => {
    setRemoving(filename);
    try {
      if (requestId) {
        await removeReviewPacketAdditionalImage(requestId, filename);
      } else if (turtleId) {
        await deleteTurtleAdditionalImage(turtleId, filename, sheetName);
      } else {
        return;
      }
      await onRefresh();
      notifications.show({
        title: 'Removed',
        message: 'Image removed',
        color: 'green',
      });
    } catch (e) {
      notifications.show({
        title: 'Error',
        message: e instanceof Error ? e.message : 'Failed to remove image',
        color: 'red',
      });
    } finally {
      setRemoving(null);
    }
  };

  // Unified entry point. If parent provides onStagePhoto (e.g. SheetsBrowser commit-on-Update),
  // route there; otherwise push into the internal staged list so the user can edit type/labels
  // per row before the explicit Upload click.
  const handleAdd = (
    type: 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional',
    files: FileList | null,
  ) => {
    if (!files?.length) return;
    if (onStagePhoto) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validation = validateFile(file);
        if (validation.isValid) {
          onStagePhoto(type, file);
        } else if (validation.error) {
          notifications.show({ title: 'Invalid file', message: validation.error, color: 'red' });
        }
      }
      return;
    }
    addFilesToStaging(type, files);
  };

  const addFilesToStaging = (
    type: StagedRow['type'],
    files: FileList | null,
  ) => {
    if (!files?.length) return;
    const next: StagedRow[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateFile(file);
      if (!validation.isValid) {
        if (validation.error) {
          notifications.show({ title: 'Invalid file', message: validation.error, color: 'red' });
        }
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      next.push({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl,
        type,
        labels: [],
      });
    }
    if (next.length) setStaged((prev) => [...prev, ...next]);
  };

  const removeStagedRow = (id: string) => {
    setStaged((prev) => {
      const row = prev.find((r) => r.id === id);
      if (row) URL.revokeObjectURL(row.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  };

  const updateStaged = (id: string, patch: Partial<Pick<StagedRow, 'type' | 'labels'>>) => {
    setStaged((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const uploadStaged = async () => {
    if (!staged.length || !canEdit) return;
    const payload = staged.map((s) => ({
      type: s.type,
      file: s.file,
      labels: s.labels.filter(Boolean).length ? s.labels.filter(Boolean) : undefined,
    }));
    setUploading(true);
    try {
      if (requestId) {
        await uploadReviewPacketAdditionalImages(requestId, payload);
      } else if (turtleId) {
        await uploadTurtleAdditionalImages(turtleId, payload, sheetName);
      } else {
        return;
      }
      staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
      setStaged([]);
      await onRefresh();
      notifications.show({
        title: 'Uploaded',
        message: `${payload.length} image(s) added`,
        color: 'green',
      });
    } catch (e) {
      notifications.show({
        title: 'Error',
        message: e instanceof Error ? e.message : 'Failed to upload',
        color: 'red',
      });
    } finally {
      setUploading(false);
    }
  };

  const saveInlineTags = async (img: AdditionalImageDisplay) => {
    if (!turtleId) return;
    const tags = inlineDraft[img.filename] ?? [];
    setSavingInline(img.filename);
    try {
      // Generic labels endpoint: works for any photo under the turtle folder
      // (active references, Old References, Other Plastrons, Other Carapaces,
      // legacy loose_images, AND additional_images). Replaces an earlier
      // additional-only call that 400'd for plastron/carapace photos in the
      // scratchpad.
      await setTurtleImageLabels(turtleId, img.imagePath, tags, sheetName);
      await onRefresh();
      notifications.show({ title: 'Saved', message: 'Tags updated', color: 'green' });
    } catch (e) {
      notifications.show({
        title: 'Error',
        message: e instanceof Error ? e.message : 'Failed to save tags',
        color: 'red',
      });
    } finally {
      setSavingInline(null);
    }
  };

  const byKind = (k: AdditionalPhotoKind) => images.filter((img) => normalizeKind(img.type) === k);

  const content = (
    <>
      <Stack gap="xs">
        <Text fw={600} size="sm">
          {title}
        </Text>
        {!embedded && (
          <Text size="xs" c="dimmed">
            Add photos first, set type and tags per image, then upload.
            {supportsPlastronExtra ? (
              <>
                {' '}
                Plastron (additional) keeps an extra underside shot in the manifest only (it does not replace
                the SuperPoint .pt reference).
              </>
            ) : null}{' '}
            Tags are searchable under Admin → Turtle records → Sheets → Photo tags.
          </Text>
        )}

        {canEdit && !hideAddButtons && (
          <>
            <Group gap="xs">
              <Button
                size="sm"
                variant="light"
                leftSection={<IconPhotoPlus size={14} />}
                component="label"
                loading={uploading}
                disabled={disabled}
              >
                Microhabitat
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    handleAdd('microhabitat', e.target.files);
                    e.target.value = '';
                  }}
                />
              </Button>
              <Button
                size="sm"
                variant="light"
                leftSection={<IconPhotoPlus size={14} />}
                component="label"
                loading={uploading}
                disabled={disabled}
              >
                Condition
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    handleAdd('condition', e.target.files);
                    e.target.value = '';
                  }}
                />
              </Button>
              <Button
                size="sm"
                variant="light"
                color={onStagePhoto ? 'red' : undefined}
                leftSection={<IconPhotoPlus size={14} />}
                component="label"
                loading={uploading}
                disabled={disabled}
              >
                Carapace
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    handleAdd('carapace', e.target.files);
                    e.target.value = '';
                  }}
                />
              </Button>
              {(onStagePhoto || supportsPlastronExtra) && (
                <Button
                  size="sm"
                  variant="light"
                  color="red"
                  leftSection={<IconPhotoPlus size={14} />}
                  component="label"
                  loading={uploading}
                  disabled={disabled}
                >
                  Plastron
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      handleAdd('plastron', e.target.files);
                      e.target.value = '';
                    }}
                  />
                </Button>
              )}
              <Button
                size="sm"
                variant="light"
                leftSection={<IconPhotoPlus size={14} />}
                component="label"
                loading={uploading}
                disabled={disabled}
              >
                Additional
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    handleAdd('additional', e.target.files);
                    e.target.value = '';
                  }}
                />
              </Button>
            </Group>

            {staged.length > 0 && (
              <Paper p="sm" withBorder radius="md" bg="var(--mantine-color-gray-0)">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      Review before upload ({staged.length})
                    </Text>
                    <Button
                      size="sm"
                      leftSection={<IconUpload size={16} />}
                      loading={uploading}
                      onClick={() => void uploadStaged()}
                    >
                      Upload {staged.length} photo{staged.length === 1 ? '' : 's'}
                    </Button>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Set tags per photo (e.g. burned vs dry habitat). Remove a row to discard before upload.
                  </Text>
                  <Stack gap="md">
                    {staged.map((row) => (
                      <Group key={row.id} align="flex-start" wrap="nowrap" gap="sm">
                        <Box
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: 8,
                            overflow: 'hidden',
                            flexShrink: 0,
                            cursor: 'pointer',
                            border: '1px solid var(--mantine-color-default-border)',
                          }}
                          onClick={() => openLightboxStaged(row.previewUrl)}
                        >
                          <Image src={row.previewUrl} alt="" w={72} h={72} fit="cover" />
                        </Box>
                        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                          <Select
                            size="xs"
                            label="Type"
                            data={[...stagingKindOptions]}
                            value={row.type}
                            onChange={(v) =>
                              v && updateStaged(row.id, { type: v as StagedRow['type'] })
                            }
                          />
                          <TagsInput
                            size="xs"
                            label="Tags for this photo"
                            placeholder="e.g. burned, dry"
                            value={row.labels}
                            onChange={(tags) => updateStaged(row.id, { labels: tags })}
                          />
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {row.file.name}
                          </Text>
                        </Stack>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="gray"
                          p={4}
                          title="Full size"
                          onClick={() => openLightboxStaged(row.previewUrl)}
                        >
                          <IconZoomIn size={16} />
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          p={4}
                          title="Remove from list"
                          onClick={() => removeStagedRow(row.id)}
                        >
                          <IconTrash size={16} />
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
              </Paper>
            )}
          </>
        )}

        {(images.length > 0 || canEdit) && (
          <Stack gap="sm">
            {images.length > 0 && (
              <>
                {!embedded && <Divider label="Saved photos" labelPosition="left" />}
                {TYPE_ORDER.map((k) => {
                  const list = byKind(k);
                  if (list.length === 0) return null;
                  return (
                    <Stack key={k} gap={4}>
                      <Text
                        size="xs"
                        fw={500}
                        c="dimmed"
                        tt={k === 'other' ? undefined : 'capitalize'}
                      >
                        {kindSectionLabel(k)}
                      </Text>
                      <Group gap="md" wrap="wrap" align="flex-start">
                        {list.map((img) => (
                          <Box key={img.filename} maw={200}>
                            <Group align="flex-start" wrap="nowrap" gap="sm">
                              <Box
                                style={{
                                  width: 80,
                                  height: 80,
                                  borderRadius: 8,
                                  overflow: 'hidden',
                                  border: '1px solid var(--mantine-color-default-border)',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                }}
                                onClick={() => openLightboxServer(img.imagePath, img.uploadTs)}
                              >
                                <Image
                                  src={getImageUrl(img.imagePath, img.uploadTs)}
                                  alt={img.filename}
                                  w={80}
                                  h={80}
                                  fit="cover"
                                />
                              </Box>
                              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                                {(img.labels ?? []).length > 0 && !canEditLabels && (
                                  <Group gap={4} wrap="wrap">
                                    {(img.labels ?? []).map((lab, li) => (
                                      <Badge
                                        key={`${img.filename}-${li}-${lab}`}
                                        size="xs"
                                        variant="light"
                                        color="gray"
                                      >
                                        {lab}
                                      </Badge>
                                    ))}
                                  </Group>
                                )}
                                {canEditLabels ? (
                                  <TagsInput
                                    size="xs"
                                    label={savingInline === img.filename ? 'Tags (saving…)' : 'Tags'}
                                    placeholder="per photo"
                                    value={inlineDraft[img.filename] ?? []}
                                    disabled={savingInline === img.filename}
                                    onChange={(tags) =>
                                      setInlineDraft((d) => ({ ...d, [img.filename]: tags }))
                                    }
                                    // Autosave on blur — committing tags no longer requires
                                    // a separate "Save tags" click. The draft is already
                                    // tracked per-filename, and saveInlineTags reads from
                                    // inlineDraft so onBlur firing here picks up the latest
                                    // value. Only saves when the draft actually differs from
                                    // what the server returned, to avoid spurious writes
                                    // when the user just clicks in/out of the field.
                                    onBlur={() => {
                                      const draft = inlineDraft[img.filename] ?? [];
                                      const current = img.labels ?? [];
                                      const same =
                                        draft.length === current.length &&
                                        draft.every((t, i) => t === current[i]);
                                      if (!same) {
                                        void saveInlineTags(img);
                                      }
                                    }}
                                  />
                                ) : (
                                  (img.labels ?? []).length === 0 &&
                                  isPacket && (
                                    <Text size="xs" c="dimmed">
                                      Add tags before upload or edit on the turtle record later.
                                    </Text>
                                  )
                                )}
                                <Group gap={4}>
                                  <Button
                                    size="xs"
                                    variant="subtle"
                                    color="gray"
                                    leftSection={<IconZoomIn size={14} />}
                                    onClick={() => openLightboxServer(img.imagePath, img.uploadTs)}
                                  >
                                    Large
                                  </Button>
                                  {canEdit && (
                                    <Button
                                      size="xs"
                                      variant="subtle"
                                      color="red"
                                      leftSection={<IconTrash size={14} />}
                                      loading={removing === img.filename}
                                      onClick={() => handleRemoveWithOverride(img)}
                                    >
                                      Remove
                                    </Button>
                                  )}
                                </Group>
                              </Stack>
                            </Group>
                          </Box>
                        ))}
                      </Group>
                    </Stack>
                  );
                })}
              </>
            )}
            {images.length === 0 && canEdit && !uploading && staged.length === 0 && (
              <Text size="xs" c="dimmed">
                No additional photos yet. Use the buttons above to add files, tag each one, then upload.
              </Text>
            )}
          </Stack>
        )}

        {images.length === 0 && !canEdit && (
          <Text size="xs" c="dimmed">
            No additional photos.
          </Text>
        )}
      </Stack>

      <Modal opened={!!lightboxSrc} onClose={closeLightbox} size="lg" title="Preview" centered>
        {lightboxSrc && (
          <Image
            src={lightboxSrc}
            alt="Full size"
            fit="contain"
            style={{ maxHeight: '80vh' }}
          />
        )}
      </Modal>
    </>
  );

  const wrapped = embedded ? (
    <>{content}</>
  ) : (
    <Paper p="sm" withBorder radius="md">
      {content}
    </Paper>
  );
  return wrapped;
}
