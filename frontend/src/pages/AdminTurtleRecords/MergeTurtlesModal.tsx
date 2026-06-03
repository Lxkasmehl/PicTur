import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  Radio,
  ScrollArea,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import {
  listAllTurtlesFromSheets,
  mergeTurtles,
  turtleDataFolderHint,
  turtleDiskFolderId,
  type TurtleSheetsData,
} from '../../services/api/sheets';
import { getImageUrl, getTurtleImages, type TurtleImagesResponse } from '../../services/api';

interface MergeTurtlesModalProps {
  opened: boolean;
  onClose: () => void;
  primaryTurtle: TurtleSheetsData;
  onMergeComplete: () => void;
}

const STEPS = ['Select Duplicate', 'Reference Photos', 'Additional Images', 'Confirm & Merge'];

function StepIndicator({ step }: { step: number }) {
  return (
    <Group gap='xs' mb='lg' wrap='wrap'>
      {STEPS.map((label, i) => (
        <Badge
          key={i}
          color={step === i ? 'blue' : step > i ? 'green' : 'gray'}
          variant={step === i ? 'filled' : 'light'}
          size='md'
        >
          {i + 1}. {label}
        </Badge>
      ))}
    </Group>
  );
}

function TurtleSummaryCard({
  turtle,
  label,
  color = 'blue',
}: {
  turtle: TurtleSheetsData;
  label: string;
  color?: string;
}) {
  return (
    <Paper p='sm' withBorder>
      <Text size='xs' c='dimmed' mb={4}>
        {label}
      </Text>
      <Text fw={600}>{turtle.id || turtle.primary_id || '—'}</Text>
      {turtle.name && <Text size='sm'>{turtle.name}</Text>}
      <Group gap='xs' mt={4}>
        {turtle.sex && (
          <Badge size='xs' color={color} variant='light'>
            {turtle.sex}
          </Badge>
        )}
        {turtle.sheet_name && (
          <Badge size='xs' color='gray' variant='light'>
            {turtle.sheet_name}
          </Badge>
        )}
      </Group>
    </Paper>
  );
}

function RefPhotoSelector({
  label,
  primaryPath,
  secondaryPath,
  value,
  onChange,
}: {
  label: string;
  primaryPath: string | null | undefined;
  secondaryPath: string | null | undefined;
  value: 'primary' | 'secondary';
  onChange: (v: 'primary' | 'secondary') => void;
}) {
  const hasPrimary = !!primaryPath;
  const hasSecondary = !!secondaryPath;

  if (!hasPrimary && !hasSecondary) {
    return (
      <Paper p='sm' withBorder>
        <Text size='sm' c='dimmed'>
          {label}: No reference photos found for either turtle.
        </Text>
      </Paper>
    );
  }

  return (
    <Paper p='sm' withBorder>
      <Text fw={500} mb='sm'>
        {label} Reference
      </Text>
      <Grid gutter='sm'>
        <Grid.Col span={6}>
          <Stack gap='xs' align='center'>
            <Text size='xs' c='dimmed'>
              Keep (Primary)
            </Text>
            {hasPrimary ? (
              <Box
                style={{
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: `2px solid ${value === 'primary' ? 'var(--mantine-color-blue-5)' : 'var(--mantine-color-default-border)'}`,
                  cursor: 'pointer',
                  width: '100%',
                  maxWidth: 200,
                }}
                onClick={() => onChange('primary')}
              >
                <Image src={getImageUrl(primaryPath, { maxDim: 300 })} alt='Primary reference' h={160} fit='contain' />
              </Box>
            ) : (
              <Center h={160} w={160} style={{ border: '1px dashed var(--mantine-color-default-border)', borderRadius: 8 }}>
                <Text size='xs' c='dimmed'>No photo</Text>
              </Center>
            )}
            <Radio
              label='Use this one'
              checked={value === 'primary'}
              onChange={() => onChange('primary')}
              disabled={!hasPrimary}
            />
          </Stack>
        </Grid.Col>
        <Grid.Col span={6}>
          <Stack gap='xs' align='center'>
            <Text size='xs' c='dimmed'>
              Merge & Delete (Secondary)
            </Text>
            {hasSecondary ? (
              <Box
                style={{
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: `2px solid ${value === 'secondary' ? 'var(--mantine-color-blue-5)' : 'var(--mantine-color-default-border)'}`,
                  cursor: 'pointer',
                  width: '100%',
                  maxWidth: 200,
                }}
                onClick={() => onChange('secondary')}
              >
                <Image src={getImageUrl(secondaryPath, { maxDim: 300 })} alt='Secondary reference' h={160} fit='contain' />
              </Box>
            ) : (
              <Center h={160} w={160} style={{ border: '1px dashed var(--mantine-color-default-border)', borderRadius: 8 }}>
                <Text size='xs' c='dimmed'>No photo</Text>
              </Center>
            )}
            <Radio
              label='Use this one'
              checked={value === 'secondary'}
              onChange={() => onChange('secondary')}
              disabled={!hasSecondary}
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Paper>
  );
}

export function MergeTurtlesModal({
  opened,
  onClose,
  primaryTurtle,
  onMergeComplete,
}: MergeTurtlesModalProps) {
  const [step, setStep] = useState(0);

  // Step 1
  const [turtleOptions, setTurtleOptions] = useState<{ value: string; label: string; data: TurtleSheetsData }[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<string | null>(null);
  const [secondaryTurtle, setSecondaryTurtle] = useState<TurtleSheetsData | null>(null);

  // Step 2 & 3
  const [primaryImages, setPrimaryImages] = useState<TurtleImagesResponse | null>(null);
  const [secondaryImages, setSecondaryImages] = useState<TurtleImagesResponse | null>(null);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [plastronSource, setPlastronSource] = useState<'primary' | 'secondary'>('primary');
  const [carapaceSource, setCarapaceSource] = useState<'primary' | 'secondary'>('primary');

  // Step 3
  const [keepPaths, setKeepPaths] = useState<Set<string>>(new Set());

  // Step 4
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Load all turtles when modal opens
  useEffect(() => {
    if (!opened) return;
    setOptionsLoading(true);
    listAllTurtlesFromSheets()
      .then((res) => {
        const opts = (res.turtles || [])
          .filter((t) => (t.primary_id || t.id) !== (primaryTurtle.primary_id || primaryTurtle.id))
          .map((t) => {
            const id = t.id || t.primary_id || '';
            const name = t.name ? ` — ${t.name}` : '';
            const sheet = t.sheet_name ? ` (${t.sheet_name})` : '';
            return { value: t.primary_id || t.id || '', label: `${id}${name}${sheet}`, data: t };
          })
          .filter((o) => o.value);
        setTurtleOptions(opts);
      })
      .catch(() => {})
      .finally(() => setOptionsLoading(false));
  }, [opened, primaryTurtle.primary_id, primaryTurtle.id]);

  // Load images for both turtles once secondary is selected
  useEffect(() => {
    if (!secondaryTurtle) return;
    setImagesLoading(true);
    Promise.all([
      getTurtleImages(
        turtleDiskFolderId(primaryTurtle),
        turtleDataFolderHint(primaryTurtle),
        primaryTurtle.primary_id,
      ),
      getTurtleImages(
        turtleDiskFolderId(secondaryTurtle),
        turtleDataFolderHint(secondaryTurtle),
        secondaryTurtle.primary_id,
      ),
    ])
      .then(([pImg, sImg]) => {
        setPrimaryImages(pImg);
        setSecondaryImages(sImg);
        // Default: all secondary additional images checked
        setKeepPaths(new Set((sImg.additional || []).map((a) => a.path)));
      })
      .catch(() => {})
      .finally(() => setImagesLoading(false));
  }, [secondaryTurtle, primaryTurtle]);

  const handleSelectSecondary = (value: string | null) => {
    setSelectedSecondaryId(value);
    const found = turtleOptions.find((o) => o.value === value);
    setSecondaryTurtle(found?.data ?? null);
    setPrimaryImages(null);
    setSecondaryImages(null);
    setPlastronSource('primary');
    setCarapaceSource('primary');
    setKeepPaths(new Set());
  };

  const handleMerge = async () => {
    if (!secondaryTurtle) return;
    setMerging(true);
    setMergeError(null);
    try {
      await mergeTurtles({
        primaryId: primaryTurtle.primary_id || primaryTurtle.id || '',
        secondaryId: secondaryTurtle.primary_id || secondaryTurtle.id || '',
        primarySheet: primaryTurtle.sheet_name || '',
        secondarySheet: secondaryTurtle.sheet_name || '',
        plastronSource,
        carapaceSource,
        keepSecondaryAdditional: Array.from(keepPaths),
      });
      notifications.show({
        title: 'Merge complete',
        message: `${secondaryTurtle.id || secondaryTurtle.primary_id} has been merged into ${primaryTurtle.id || primaryTurtle.primary_id} and deleted.`,
        color: 'green',
      });
      onMergeComplete();
      handleClose();
    } catch (e: unknown) {
      setMergeError(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  const handleClose = () => {
    setStep(0);
    setSelectedSecondaryId(null);
    setSecondaryTurtle(null);
    setPrimaryImages(null);
    setSecondaryImages(null);
    setPlastronSource('primary');
    setCarapaceSource('primary');
    setKeepPaths(new Set());
    setMergeError(null);
    onClose();
  };

  const toggleKeepPath = (path: string) => {
    setKeepPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const secondaryAdditional = secondaryImages?.additional || [];
  const keptCount = secondaryAdditional.filter((a) => keepPaths.has(a.path)).length;
  const discardedCount = secondaryAdditional.length - keptCount;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title='Merge Duplicate Turtle'
      size='xl'
      centered
      closeOnClickOutside={!merging}
      closeOnEscape={!merging}
    >
      <StepIndicator step={step} />

      {/* ── Step 1: Select secondary ── */}
      {step === 0 && (
        <Stack gap='md'>
          <TurtleSummaryCard turtle={primaryTurtle} label='Keep (Primary)' color='green' />
          <Divider label='Select the duplicate to delete' labelPosition='center' />
          <Select
            label='Duplicate turtle to merge in and delete'
            placeholder='Search by ID or name…'
            data={turtleOptions}
            value={selectedSecondaryId}
            onChange={handleSelectSecondary}
            searchable
            disabled={optionsLoading}
            rightSection={optionsLoading ? <Loader size='xs' /> : undefined}
            nothingFoundMessage='No turtles found'
            maxDropdownHeight={260}
          />
          {secondaryTurtle && (
            <TurtleSummaryCard turtle={secondaryTurtle} label='Will be merged & deleted (Secondary)' color='red' />
          )}
          <Alert color='orange' icon={<IconAlertTriangle size={16} />}>
            The duplicate turtle's record will be <strong>permanently deleted</strong> from Google Sheets.
            Its photos will be moved into the primary turtle's folder. This cannot be undone.
          </Alert>
          <Group justify='flex-end'>
            <Button variant='default' onClick={handleClose}>
              Cancel
            </Button>
            <Button
              disabled={!secondaryTurtle}
              onClick={() => setStep(1)}
            >
              Next: Reference Photos
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── Step 2: Choose reference photos ── */}
      {step === 1 && (
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Choose which turtle's plastron and carapace photo becomes the active reference after
            the merge. The other photo is archived to Old References.
          </Text>
          {imagesLoading ? (
            <Center py='xl'>
              <Loader />
            </Center>
          ) : (
            <>
              <RefPhotoSelector
                label='Plastron'
                primaryPath={primaryImages?.primary}
                secondaryPath={secondaryImages?.primary}
                value={plastronSource}
                onChange={setPlastronSource}
              />
              <RefPhotoSelector
                label='Carapace'
                primaryPath={primaryImages?.primary_carapace}
                secondaryPath={secondaryImages?.primary_carapace}
                value={carapaceSource}
                onChange={setCarapaceSource}
              />
            </>
          )}
          <Group justify='space-between'>
            <Button variant='default' onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)}>Next: Additional Images</Button>
          </Group>
        </Stack>
      )}

      {/* ── Step 3: Review additional images ── */}
      {step === 2 && (
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Choose which of the duplicate turtle's additional images to keep. Unchecked images will
            be discarded when the duplicate folder is deleted. Primary turtle's images are always kept.
          </Text>
          {imagesLoading ? (
            <Center py='xl'>
              <Loader />
            </Center>
          ) : secondaryAdditional.length === 0 ? (
            <Paper p='md' withBorder>
              <Text size='sm' c='dimmed' ta='center'>
                The duplicate turtle has no additional images.
              </Text>
            </Paper>
          ) : (
            <>
              <Group gap='xs'>
                <Button
                  size='xs'
                  variant='light'
                  onClick={() => setKeepPaths(new Set(secondaryAdditional.map((a) => a.path)))}
                >
                  Select all
                </Button>
                <Button
                  size='xs'
                  variant='light'
                  color='gray'
                  onClick={() => setKeepPaths(new Set())}
                >
                  Deselect all
                </Button>
                <Text size='xs' c='dimmed'>
                  {keptCount} kept · {discardedCount} discarded
                </Text>
              </Group>
              <ScrollArea h={380}>
                <Grid gutter='sm'>
                  {secondaryAdditional.map((img) => {
                    const checked = keepPaths.has(img.path);
                    return (
                      <Grid.Col key={img.path} span={{ base: 6, sm: 4, md: 3 }}>
                        <Paper
                          p='xs'
                          withBorder
                          style={{
                            cursor: 'pointer',
                            opacity: checked ? 1 : 0.4,
                            border: checked ? '2px solid var(--mantine-color-blue-5)' : undefined,
                          }}
                          onClick={() => toggleKeepPath(img.path)}
                        >
                          <Image
                            src={getImageUrl(img.path, { maxDim: 200 })}
                            alt={img.type}
                            h={120}
                            fit='cover'
                            radius='sm'
                          />
                          <Group gap={4} mt={4} wrap='nowrap'>
                            <Checkbox
                              size='xs'
                              checked={checked}
                              onChange={() => toggleKeepPath(img.path)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Text size='xs' truncate>
                              {img.type || 'photo'}
                            </Text>
                          </Group>
                          {img.upload_date && (
                            <Text size='xs' c='dimmed'>
                              {img.upload_date}
                            </Text>
                          )}
                        </Paper>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              </ScrollArea>
            </>
          )}
          <Group justify='space-between'>
            <Button variant='default' onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Next: Confirm</Button>
          </Group>
        </Stack>
      )}

      {/* ── Step 4: Confirm ── */}
      {step === 3 && secondaryTurtle && (
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Review the merge settings below and click <strong>Confirm Merge</strong> to proceed.
          </Text>
          <Grid>
            <Grid.Col span={6}>
              <TurtleSummaryCard turtle={primaryTurtle} label='Keep (Primary)' color='green' />
            </Grid.Col>
            <Grid.Col span={6}>
              <TurtleSummaryCard turtle={secondaryTurtle} label='Will be deleted (Secondary)' color='red' />
            </Grid.Col>
          </Grid>
          <Paper p='sm' withBorder>
            <Stack gap={4}>
              <Text size='sm'>
                <strong>Plastron reference:</strong>{' '}
                {plastronSource === 'primary'
                  ? 'Keep primary turtle\'s plastron'
                  : 'Use secondary turtle\'s plastron (re-indexed)'}
              </Text>
              <Text size='sm'>
                <strong>Carapace reference:</strong>{' '}
                {carapaceSource === 'primary'
                  ? 'Keep primary turtle\'s carapace'
                  : 'Use secondary turtle\'s carapace (re-indexed)'}
              </Text>
              <Text size='sm'>
                <strong>Additional images from duplicate:</strong> {keptCount} kept
                {discardedCount > 0 && `, ${discardedCount} discarded`}
              </Text>
              <Text size='sm'>
                <strong>Notes:</strong> Secondary's notes will be appended to primary's notes.
              </Text>
              <Text size='sm'>
                <strong>Dates refound:</strong> Dates from both records will be merged.
              </Text>
            </Stack>
          </Paper>
          <Alert color='red' icon={<IconAlertTriangle size={16} />}>
            <strong>This action is permanent.</strong> The duplicate turtle (
            {secondaryTurtle.id || secondaryTurtle.primary_id}) will be deleted from Google Sheets
            and its folder removed. This cannot be undone.
          </Alert>
          {mergeError && (
            <Alert color='red' title='Merge failed'>
              {mergeError}
            </Alert>
          )}
          <Group justify='space-between'>
            <Button variant='default' onClick={() => setStep(2)} disabled={merging}>
              Back
            </Button>
            <Button color='red' onClick={handleMerge} loading={merging}>
              Confirm Merge
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
