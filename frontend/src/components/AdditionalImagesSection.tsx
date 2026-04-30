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
import { useEffect, useRef, useState, type DragEvent } from 'react';
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
import {
  ADDITIONAL_PHOTO_KIND_OPTIONS,
  additionalPhotoKindLabel,
  normalizeAdditionalPhotoKind,
  type AdditionalPhotoKind,
} from '../constants/additionalPhotoKinds';

/**
 * Display-only kinds that are *derived* from on-disk location, never
 * user-pickable. The scratchpad / Old Photos viewer uses these to group
 * plastron / carapace photos by role (active reference vs. archived old
 * reference vs. an extra) so multiple uploads on the same day stay grouped
 * instead of collapsing into a single pile. ``loose_legacy`` covers files
 * still living in the pre-migration ``loose_images/`` folder.
 */
export type ScratchpadOnlyKind =
  | 'plastron_active'
  | 'plastron_old_ref'
  | 'plastron_other'
  | 'carapace_active'
  | 'carapace_old_ref'
  | 'carapace_other'
  | 'loose_legacy';

/**
 * Every kind the rendered staged-photo grid knows how to display:
 * canonical kinds the user can stage (carapace / plastron / anterior /
 * posterior / left-side / right-side / people / microhabitat / condition /
 * injury / other) plus the scratchpad-only role-suffixed variants.
 */
export type DisplayKind = AdditionalPhotoKind | ScratchpadOnlyKind;

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
  /** Globally-unique primary id used as the FIRST folder-lookup key on the
   *  backend. Required for cross-state biology-id collisions and for cases
   *  where the on-disk folder name doesn't match the sheet's current bio_id
   *  (stray folders / not-yet-renamed combined names). When omitted, only
   *  the bio-id walk is attempted, which can mis-resolve or fail. */
  primaryId?: string | null;
  disabled?: boolean;
  embedded?: boolean;
  hideAddButtons?: boolean;
  /** When provided, ALL button clicks stage via this callback instead of uploading immediately.
   *  Parent owns the staged files and commits them on save. Plastron button becomes visible,
   *  and plastron/carapace are rendered in red to signal they may replace the current reference.
   *  Leave undefined for packet-mode / immediate-upload behavior. */
  onStagePhoto?: (type: AdditionalPhotoKind, file: File) => void;
  /** Override for the delete button. When provided, clicking trash calls this instead
   *  of the built-in handler, and it is the parent's responsibility to refetch. Used
   *  by scratchpad callers so the confirm-modal and soft-delete routing lives in one
   *  place instead of being duplicated here. */
  onDelete?: (photo: AdditionalImageDisplay) => Promise<void> | void;
}

// Display ordering for the rendered staged-photos grid: scratchpad-only
// role variants first (active ref → old ref → other), then the canonical
// generic kinds (the eleven main introduced), then the legacy loose bucket.
// Keep separate from BUTTON_KINDS — only canonical kinds get an upload
// button (scratchpad-only kinds are derived from on-disk location).
const TYPE_ORDER: DisplayKind[] = [
  'plastron_active',
  'plastron_old_ref',
  'plastron_other',
  'carapace_active',
  'carapace_old_ref',
  'carapace_other',
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
  'loose_legacy',
  'other',
];

function normalizeKind(t: string): DisplayKind {
  const s = (t || '').toLowerCase();
  if (
    s === 'plastron_active' ||
    s === 'plastron_old_ref' ||
    s === 'plastron_other' ||
    s === 'carapace_active' ||
    s === 'carapace_old_ref' ||
    s === 'carapace_other' ||
    s === 'loose_legacy'
  ) {
    return s;
  }
  // Falls through to main's canonical normalizer (head/tail aliases, anything
  // unknown collapses to 'other'). Legacy 'additional' is aliased to 'other'.
  if (s === 'additional') return 'other';
  return normalizeAdditionalPhotoKind(s || 'other');
}

function kindSectionLabel(k: DisplayKind): string {
  switch (k) {
    case 'plastron_active':
      return 'Plastron (active reference)';
    case 'plastron_old_ref':
      return 'Plastron (old reference)';
    case 'plastron_other':
      return 'Plastron (additional)';
    case 'carapace_active':
      return 'Carapace (active reference)';
    case 'carapace_old_ref':
      return 'Carapace (old reference)';
    case 'carapace_other':
      return 'Carapace (additional)';
    case 'loose_legacy':
      return 'Loose (legacy)';
    default:
      return additionalPhotoKindLabel(k);
  }
}

type StagedRow = {
  id: string;
  file: File;
  previewUrl: string;
  /** Canonical kind only — staged uploads route through one of the eleven
   *  canonical buttons. Scratchpad-only kinds never appear here. */
  type: AdditionalPhotoKind;
  labels: string[];
};

interface UploadTypeButtonProps {
  kind: AdditionalPhotoKind;
  disabled: boolean;
  onFiles: (kind: AdditionalPhotoKind, files: FileList | null) => void;
}

function UploadTypeButton({ kind, disabled, onFiles }: UploadTypeButtonProps) {
  const [dragOver, setDragOver] = useState(false);

  const onDropFiles = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (disabled) return;
    onFiles(kind, event.dataTransfer.files);
  };

  return (
    <Button
      size="sm"
      variant={dragOver ? 'filled' : 'light'}
      leftSection={<IconPhotoPlus size={14} />}
      component="label"
      disabled={disabled}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDropFiles}
      style={
        dragOver
          ? {
              border: '1px dashed var(--mantine-color-blue-filled)',
            }
          : undefined
      }
    >
      {additionalPhotoKindLabel(kind)}
      <input
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(kind, e.target.files);
          e.target.value = '';
        }}
      />
    </Button>
  );
}

export function AdditionalImagesSection({
  title = 'Additional photos',
  images,
  onRefresh,
  requestId,
  turtleId,
  sheetName = null,
  primaryId = null,
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
  // Per-image controlled "currently-typed" text inside each TagsInput.
  // Tracked separately from the committed value array so the autosave on
  // blur can pick up text the user typed without pressing Enter — Mantine
  // v8's acceptValueOnBlur does not reliably call onChange before our
  // onBlur prop in this version, so we merge the pending text in
  // ourselves.
  const [inlineSearchValue, setInlineSearchValue] = useState<Record<string, string>>({});
  // Synchronous mirrors of the React state above so onBlur reads the just-
  // typed value before React has flushed batched updates from onChange /
  // onSearchChange within the same blur event.
  const inlineDraftRef = useRef<Record<string, string[]>>({});
  const inlineSearchValueRef = useRef<Record<string, string>>({});

  const isPacket = !!requestId;
  const isTurtle = !!turtleId;
  const canEdit = (isPacket || isTurtle) && !disabled;
  const canEditLabels = isTurtle && !disabled;
  const stagingKindOptions = ADDITIONAL_PHOTO_KIND_OPTIONS;

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
    inlineDraftRef.current = next;
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
  const handleAdd = (type: AdditionalPhotoKind, files: FileList | null) => {
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

  const addFilesToStaging = (type: AdditionalPhotoKind, files: FileList | null) => {
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
        await uploadTurtleAdditionalImages(turtleId, payload, sheetName, primaryId);
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

  const saveInlineTags = async (img: AdditionalImageDisplay, tagsOverride?: string[]) => {
    if (!turtleId) return;
    // Prefer the caller-supplied tags (typically the value the onBlur
    // handler captured from the synchronous draft ref) so we don't lose a
    // typed-but-not-yet-Entered tag to React's batched state update. Falls
    // back to the React state when no override is passed.
    const tags = tagsOverride ?? inlineDraft[img.filename] ?? [];
    setSavingInline(img.filename);
    try {
      // Generic labels endpoint: works for any photo under the turtle folder
      // (active references, Old References, Other Plastrons, Other Carapaces,
      // legacy loose_images, AND additional_images). Replaces an earlier
      // additional-only call that 400'd for plastron/carapace photos in the
      // scratchpad.
      await setTurtleImageLabels(turtleId, img.imagePath, tags, sheetName, primaryId);
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

  // DisplayKind covers BOTH the canonical user-pickable kinds AND the
  // scratchpad-only role variants (plastron_active / plastron_old_ref /
  // plastron_other / carapace_*). Pre-fix this used
  // normalizeAdditionalPhotoKind which collapses anything not in the
  // canonical 11 to 'other', so scratchpad rows of type 'plastron_active'
  // (etc.) silently fell into the "Other" bucket and the role-grouped
  // headers ("Plastron (active reference)" / "Plastron (old reference)" /
  // "Plastron (additional)" / carapace mirrors / "Loose (legacy)") never
  // rendered. The local normalizeKind handles both unions and was already
  // defined for exactly this purpose.
  const byKind = (k: DisplayKind) =>
    images.filter((img) => normalizeKind(img.type) === k);

  const content = (
    <>
      <Stack gap="xs">
        <Text fw={600} size="sm">
          {title}
        </Text>
        {!embedded && (
          <Text size="xs" c="dimmed">
            Add photos first, set type and tags per image, then upload.
            {' '}
            The Plastron button keeps an extra underside shot in the manifest only (it does not replace
            the SuperPoint .pt reference).{' '}
            Tags are searchable under Admin → Turtle records → Sheets → Photo tags.
          </Text>
        )}

        {canEdit && !hideAddButtons && (
          <>
            <Text size="xs" fw={500}>
              1. Choose or drag photos onto a category (you can change type per row below)
            </Text>
            <Group gap="xs">
              {(isPacket && !onStagePhoto
                ? ADDITIONAL_PHOTO_KIND_OPTIONS.filter((opt) => opt.value !== 'plastron')
                : ADDITIONAL_PHOTO_KIND_OPTIONS
              ).map(({ value }) => (
                <UploadTypeButton
                  key={value}
                  kind={value}
                  disabled={disabled || uploading}
                  onFiles={handleAdd}
                />
              ))}
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
                      >
                        {/* kindSectionLabel handles BOTH scratchpad-only
                            roles (plastron_active / plastron_old_ref / ...)
                            and canonical kinds; additionalPhotoKindLabel
                            collapses anything outside its 11-kind set to
                            'Other', which silently turned every
                            role-grouped header into "Other" after the
                            main merge. */}
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
                                  src={getImageUrl(img.imagePath, { version: img.uploadTs, maxDim: 160 })}
                                  alt={img.filename}
                                  w={80}
                                  h={80}
                                  fit="cover"
                                  loading="lazy"
                                  decoding="async"
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
                                    // Control the typed text so we can read it on blur
                                    // even if Mantine's own acceptValueOnBlur didn't
                                    // commit it via onChange before our handler ran.
                                    searchValue={inlineSearchValue[img.filename] ?? ''}
                                    onSearchChange={(v) => {
                                      inlineSearchValueRef.current = {
                                        ...inlineSearchValueRef.current,
                                        [img.filename]: v,
                                      };
                                      setInlineSearchValue((s) => ({ ...s, [img.filename]: v }));
                                    }}
                                    onChange={(tags) => {
                                      // Mirror to the ref synchronously so onBlur reads
                                      // the latest committed tag list without waiting on
                                      // React's batched state update.
                                      inlineDraftRef.current = {
                                        ...inlineDraftRef.current,
                                        [img.filename]: tags,
                                      };
                                      setInlineDraft((d) => ({ ...d, [img.filename]: tags }));
                                    }}
                                    // Autosave on blur. Merges any pending typed text
                                    // (still in the input, never Entered) with the
                                    // committed tags so "type then click out" saves
                                    // identically to "type, Enter, click out".
                                    onBlur={() => {
                                      const draft = inlineDraftRef.current[img.filename] ?? [];
                                      const pending = (inlineSearchValueRef.current[img.filename] ?? '').trim();
                                      const merged =
                                        pending && !draft.includes(pending)
                                          ? [...draft, pending]
                                          : draft;
                                      const current = img.labels ?? [];
                                      const same =
                                        merged.length === current.length &&
                                        merged.every((t, i) => t === current[i]);
                                      // Always clear the typed-but-not-committed text so
                                      // a focus-out → focus-back-in cycle starts clean.
                                      inlineSearchValueRef.current = {
                                        ...inlineSearchValueRef.current,
                                        [img.filename]: '',
                                      };
                                      setInlineSearchValue((s) => ({ ...s, [img.filename]: '' }));
                                      if (!same) {
                                        // Reflect the merge into state so the chip for
                                        // the just-committed tag renders immediately,
                                        // before saveInlineTags' onRefresh roundtrip.
                                        inlineDraftRef.current = {
                                          ...inlineDraftRef.current,
                                          [img.filename]: merged,
                                        };
                                        setInlineDraft((d) => ({ ...d, [img.filename]: merged }));
                                        void saveInlineTags(img, merged);
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
