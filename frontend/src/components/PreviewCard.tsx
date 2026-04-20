import {
  Box,
  Card,
  Stack,
  Group,
  Grid,
  Image,
  Button,
  Text,
  Badge,
  Alert,
  Progress,
  Center,
  Loader,
  TextInput,
  SegmentedControl,
  Select,
  Divider,
  Paper,
  TagsInput,
  Modal,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Transition } from '@mantine/core';
import {
  IconCheck,
  IconAlertCircle,
  IconCloudUpload,
  IconTrash,
  IconClock,
  IconSparkles,
  IconCurrentLocation,
  IconFlag,
  IconPhotoPlus,
  IconZoomIn,
} from '@tabler/icons-react';
import { useState, useEffect, useRef } from 'react';
import type { FileWithPath } from '@mantine/dropzone';
import type { LocationHint, UploadExtraFile } from '../services/api';
import { MapPicker } from './MapPicker';
import { validateFile } from '../utils/fileValidation';
import { notifications } from '@mantine/notifications';

interface PreviewCardProps {
  preview: string | null;
  files: FileWithPath[];
  uploadState: 'idle' | 'uploading' | 'success' | 'error';
  uploadProgress: number;
  uploadResponse: string | null;
  imageId: string | null;
  isDuplicate: boolean;
  previousUploadDate: string | null;
  isGettingLocation: boolean;
  /** True when the user has denied location permission (show allow-in-settings message). */
  locationPermissionDenied?: boolean;
  role?: string;
  /** Optional location hint (coords) – only in queue, never in sheets */
  locationHint?: LocationHint | null;
  setLocationHint?: (hint: LocationHint | null) => void;
  requestLocationHint?: () => Promise<void>;
  /** Admin: will this turtle be taken to the lab? (community cannot take turtles to lab) */
  collectedToLab?: 'yes' | 'no' | null;
  setCollectedToLab?: (v: 'yes' | 'no' | null) => void;
  /** Admin: physical flag at position (when taken to lab) */
  physicalFlag?: 'yes' | 'no' | 'no_flag' | null;
  setPhysicalFlag?: (v: 'yes' | 'no' | 'no_flag' | null) => void;
  /** Optional extra images (microhabitat, condition) */
  extraFiles?: UploadExtraFile[];
  setExtraFiles?: (files: UploadExtraFile[] | ((prev: UploadExtraFile[]) => UploadExtraFile[])) => void;
  onUpload: () => void;
  onRemove: () => void;
}

export function PreviewCard({
  preview,
  files,
  uploadState,
  uploadProgress,
  uploadResponse,
  imageId,
  isDuplicate,
  previousUploadDate,
  isGettingLocation,
  locationPermissionDenied = false,
  role,
  locationHint,
  setLocationHint,
  requestLocationHint,
  collectedToLab,
  setCollectedToLab,
  physicalFlag,
  setPhysicalFlag,
  extraFiles = [],
  setExtraFiles,
  onUpload,
  onRemove,
}: PreviewCardProps) {
  const [stillAtLocation, setStillAtLocation] = useState<'yes' | 'no' | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [extraPreviewUrls, setExtraPreviewUrls] = useState<string[]>([]);
  const [lightboxObjectUrl, setLightboxObjectUrl] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 576px)');

  const prevStillAtLocation = useRef<'yes' | 'no' | null>(null);
  // When user selects "I'm still at the turtle's location", request GPS immediately (once per switch to 'yes')
  useEffect(() => {
    if (
      stillAtLocation === 'yes' &&
      prevStillAtLocation.current !== 'yes' &&
      requestLocationHint
    ) {
      requestLocationHint();
    }
    prevStillAtLocation.current = stillAtLocation;
  }, [stillAtLocation, requestLocationHint]);

  // Default to "Skip" location when starting a new upload so multiple turtles don't share the same pin
  const fileKey = files.length ? files[0]?.name ?? '' : '';
  useEffect(() => {
    setStillAtLocation(null);
    setManualLat('');
    setManualLon('');
    if (setLocationHint) setLocationHint(null);
    if (setCollectedToLab) setCollectedToLab(null);
    if (setPhysicalFlag) setPhysicalFlag(null);
    if (setExtraFiles) setExtraFiles([]);
  }, [fileKey, setLocationHint, setCollectedToLab, setPhysicalFlag, setExtraFiles]);

  useEffect(() => {
    const urls = extraFiles.map((ef) => URL.createObjectURL(ef.file));
    setExtraPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [extraFiles]);

  if (!preview) return null;

  return (
    <Transition mounted={true} transition='fade' duration={300} timingFunction='ease'>
      {(styles) => (
        <Card shadow='xs' padding='md' radius='md' withBorder style={styles}>
          <Stack gap='md'>
            <Group justify='space-between' align='center'>
              <Text size='lg' fw={500}>
                Preview
              </Text>
              {uploadState === 'success' && (
                <Badge color='green' leftSection={<IconCheck size={14} />} size='lg'>
                  Successfully Uploaded
                </Badge>
              )}
              {uploadState === 'error' && (
                <Badge color='red' leftSection={<IconAlertCircle size={14} />} size='lg'>
                  Error
                </Badge>
              )}
            </Group>

            <Image
              src={preview}
              alt='Uploaded photo'
              radius='md'
              style={{ maxWidth: '100%', height: 'auto' }}
            />

            {files.length > 0 && (
              <Text size='sm' c='dimmed'>
                File: {files[0].name} ({(files[0].size / 1024 / 1024).toFixed(2)} MB)
              </Text>
            )}

            {/* Additional photos – per-image type, tags, preview, lightbox (same idea as Admin additional photos) */}
            {uploadState === 'idle' && setExtraFiles && (
              <Paper p='sm' withBorder radius='md'>
                <Text fw={600} size='sm' mb='xs'>
                  Additional photos (optional)
                </Text>
                <Text size='xs' c='dimmed' mb='sm'>
                  Add photos first. For each row set type and tags, preview with a click, remove if wrong. These
                  upload with your main photo.
                </Text>
                <Group gap='xs' mb='sm'>
                  <Button size='sm' variant='light' leftSection={<IconPhotoPlus size={14} />} component='label'>
                    Carapace
                    <input
                      type='file'
                      accept='image/*'
                      multiple
                      hidden
                      onChange={(e) => {
                        const list = e.target.files;
                        if (!list?.length) return;
                        const valid: UploadExtraFile[] = [];
                        for (let i = 0; i < list.length; i++) {
                          const file = list[i];
                          const validation = validateFile(file);
                          if (validation.isValid) {
                            valid.push({
                              type: 'carapace',
                              file,
                              labels: [],
                              localId: crypto.randomUUID(),
                            });
                          } else if (validation.error) {
                            notifications.show({
                              title: 'Invalid file',
                              message: validation.error,
                              color: 'red',
                            });
                          }
                        }
                        if (valid.length) setExtraFiles((prev) => [...prev, ...valid]);
                        e.target.value = '';
                      }}
                    />
                  </Button>
                  <Button size='sm' variant='light' leftSection={<IconPhotoPlus size={14} />} component='label'>
                    Microhabitat
                    <input
                      type='file'
                      accept='image/*'
                      multiple
                      hidden
                      onChange={(e) => {
                        const list = e.target.files;
                        if (!list?.length) return;
                        const valid: UploadExtraFile[] = [];
                        for (let i = 0; i < list.length; i++) {
                          const file = list[i];
                          const validation = validateFile(file);
                          if (validation.isValid) {
                            valid.push({
                              type: 'microhabitat',
                              file,
                              labels: [],
                              localId: crypto.randomUUID(),
                            });
                          } else if (validation.error) {
                            notifications.show({
                              title: 'Invalid file',
                              message: validation.error,
                              color: 'red',
                            });
                          }
                        }
                        if (valid.length) setExtraFiles((prev) => [...prev, ...valid]);
                        e.target.value = '';
                      }}
                    />
                  </Button>
                  <Button size='sm' variant='light' leftSection={<IconPhotoPlus size={14} />} component='label'>
                    Condition
                    <input
                      type='file'
                      accept='image/*'
                      multiple
                      hidden
                      onChange={(e) => {
                        const list = e.target.files;
                        if (!list?.length) return;
                        const valid: UploadExtraFile[] = [];
                        for (let i = 0; i < list.length; i++) {
                          const file = list[i];
                          const validation = validateFile(file);
                          if (validation.isValid) {
                            valid.push({
                              type: 'condition',
                              file,
                              labels: [],
                              localId: crypto.randomUUID(),
                            });
                          } else if (validation.error) {
                            notifications.show({
                              title: 'Invalid file',
                              message: validation.error,
                              color: 'red',
                            });
                          }
                        }
                        if (valid.length) setExtraFiles((prev) => [...prev, ...valid]);
                        e.target.value = '';
                      }}
                    />
                  </Button>
                  <Button size='sm' variant='light' leftSection={<IconPhotoPlus size={14} />} component='label'>
                    Other
                    <input
                      type='file'
                      accept='image/*'
                      multiple
                      hidden
                      onChange={(e) => {
                        const list = e.target.files;
                        if (!list?.length) return;
                        const valid: UploadExtraFile[] = [];
                        for (let i = 0; i < list.length; i++) {
                          const file = list[i];
                          const validation = validateFile(file);
                          if (validation.isValid) {
                            valid.push({
                              type: 'other',
                              file,
                              labels: [],
                              localId: crypto.randomUUID(),
                            });
                          } else if (validation.error) {
                            notifications.show({
                              title: 'Invalid file',
                              message: validation.error,
                              color: 'red',
                            });
                          }
                        }
                        if (valid.length) setExtraFiles((prev) => [...prev, ...valid]);
                        e.target.value = '';
                      }}
                    />
                  </Button>
                </Group>
                {extraFiles.length > 0 && (
                  <Stack gap='md'>
                    {extraFiles.map((ef, index) => {
                      const thumb = extraPreviewUrls[index];
                      return (
                        <Paper key={ef.localId ?? `${index}-${ef.file.name}`} p='xs' withBorder radius='md'>
                          <Group align='flex-start' wrap='nowrap' gap='sm'>
                            <Box
                              style={{
                                width: 72,
                                height: 72,
                                borderRadius: 8,
                                overflow: 'hidden',
                                flexShrink: 0,
                                cursor: thumb ? 'pointer' : 'default',
                                border: '1px solid var(--mantine-color-default-border)',
                              }}
                              onClick={() => thumb && setLightboxObjectUrl(thumb)}
                            >
                              {thumb ? (
                                <Image src={thumb} alt='' w={72} h={72} fit='cover' />
                              ) : (
                                <Center w={72} h={72} bg='gray.1' />
                              )}
                            </Box>
                            <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                              <Select
                                size='xs'
                                label='Type'
                                data={[
                                  { value: 'carapace', label: 'Carapace' },
                                  { value: 'microhabitat', label: 'Microhabitat' },
                                  { value: 'condition', label: 'Condition' },
                                  { value: 'other', label: 'Other' },
                                ]}
                                value={ef.type}
                                onChange={(v) => {
                                  if (!v) return;
                                  setExtraFiles((prev) =>
                                    prev.map((row, i) =>
                                      i === index ? { ...row, type: v as UploadExtraFile['type'] } : row,
                                    ),
                                  );
                                }}
                              />
                              <TagsInput
                                size='xs'
                                label='Tags for this photo'
                                placeholder='e.g. burned, dry'
                                value={ef.labels ?? []}
                                onChange={(tags) =>
                                  setExtraFiles((prev) =>
                                    prev.map((row, i) => (i === index ? { ...row, labels: tags } : row)),
                                  )
                                }
                              />
                              <Text size='xs' c='dimmed' lineClamp={1}>
                                {ef.file.name}
                              </Text>
                            </Stack>
                            <Stack gap={4}>
                              <Button
                                size='xs'
                                variant='subtle'
                                color='gray'
                                p={4}
                                title='Large preview'
                                disabled={!thumb}
                                onClick={() => thumb && setLightboxObjectUrl(thumb)}
                              >
                                <IconZoomIn size={16} />
                              </Button>
                              <Button
                                size='xs'
                                variant='subtle'
                                color='red'
                                p={4}
                                title='Remove'
                                onClick={() =>
                                  setExtraFiles((prev) => prev.filter((_, idx) => idx !== index))
                                }
                              >
                                <IconTrash size={16} />
                              </Button>
                            </Stack>
                          </Group>
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
                <Modal
                  opened={!!lightboxObjectUrl}
                  onClose={() => setLightboxObjectUrl(null)}
                  title='Preview'
                  size='lg'
                  centered
                >
                  {lightboxObjectUrl && (
                    <Image
                      src={lightboxObjectUrl}
                      alt='Additional'
                      fit='contain'
                      style={{ maxHeight: '80vh' }}
                    />
                  )}
                </Modal>
              </Paper>
            )}

            {/* Collected to lab + physical flag (admin only): first ask if taking to lab, then flag questions */}
            {(role === 'staff' || role === 'admin') && uploadState === 'idle' && setCollectedToLab && setPhysicalFlag && (
              <Stack gap='sm'>
                <Text size='sm' fw={500}>
                  Will you take this turtle to the lab?
                </Text>
                <SegmentedControl
                  value={collectedToLab ?? ''}
                  onChange={(v) => {
                    const val = v === 'yes' || v === 'no' ? v : null;
                    setCollectedToLab(val ?? null);
                    if (val !== 'yes') setPhysicalFlag(null);
                  }}
                  data={[
                    { label: 'Skip', value: '' },
                    { label: 'Yes', value: 'yes' },
                    { label: 'No', value: 'no' },
                  ]}
                  fullWidth
                />
                {collectedToLab === 'yes' && (
                  <>
                    <Text size='xs' c='dimmed'>
                      Please place a physical flag at the spot so the turtle can be returned to the exact position. Did you place one?
                    </Text>
                    <Select
                      placeholder='Select...'
                      leftSection={<IconFlag size={14} />}
                      value={physicalFlag ?? ''}
                      onChange={(v) =>
                        setPhysicalFlag(
                          v === 'yes' || v === 'no' || v === 'no_flag' ? v : null
                        )
                      }
                      data={[
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                        { value: 'no_flag', label: 'No flag (ran out)' },
                      ]}
                      clearable
                      allowDeselect
                    />
                  </>
                )}
                {collectedToLab === 'yes' && (
                  <Text size='xs' c='dimmed'>
                    Set the digital flag below (exact release position) so the turtle can be returned to the same spot.
                  </Text>
                )}
                <Divider />
              </Stack>
            )}

            {/* Digital flag (when collected to lab) or location hint (optional): community always; admin only when taking to lab */}
            {(role === 'community' || ((role === 'staff' || role === 'admin') && collectedToLab === 'yes')) && uploadState === 'idle' && (
              <Stack gap='sm'>
                {collectedToLab === 'yes' ? (
                  <Alert color='orange' radius='md'>
                    <Text size='xs' fw={500}>
                      Set digital flag (release position)
                    </Text>
                    <Text size='xs' mt={4}>
                      Use GPS or pick on the map so we can return the turtle to the exact spot.
                    </Text>
                  </Alert>
                ) : (
                  <Alert color='blue' radius='md'>
                    <Text size='xs'>
                      Optionally share where you found this turtle (shown to admins as a hint only).
                    </Text>
                  </Alert>
                )}
                <Stack gap='xs'>
                  <Text size='sm' fw={500}>
                    {collectedToLab === 'yes' ? 'Release position (digital flag)' : 'Exact spot (optional)'}
                  </Text>
                  <SegmentedControl
                    value={stillAtLocation ?? ''}
                    onChange={(v) => {
                      const val = v === 'yes' || v === 'no' ? v : null;
                      setStillAtLocation(val ?? null);
                      if (setLocationHint) setLocationHint(null);
                      if (val === 'no') {
                        setManualLat('');
                        setManualLon('');
                      }
                    }}
                    data={[
                      { label: 'Skip', value: '' },
                      { label: "I'm still at the turtle's location", value: 'yes' },
                      { label: "I'm not there anymore", value: 'no' },
                    ]}
                    fullWidth
                  />
                  {stillAtLocation === 'yes' && setLocationHint && (
                    <Group gap='xs'>
                      {isGettingLocation ? (
                        <Text
                          size='xs'
                          c='dimmed'
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Loader size={14} />
                          Getting your location…
                        </Text>
                      ) : locationHint?.source === 'gps' ? (
                        <>
                          <Text
                            size='xs'
                            c='dimmed'
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <IconCurrentLocation size={14} />
                            Location shared: {locationHint.latitude.toFixed(5)},{' '}
                            {locationHint.longitude.toFixed(5)}
                          </Text>
                          <Button
                            size='xs'
                            variant='subtle'
                            color='gray'
                            onClick={() => setLocationHint(null)}
                          >
                            Clear
                          </Button>
                        </>
                      ) : locationPermissionDenied ? (
                        <Text size='xs' c='dimmed'>
                          Please allow location access in your browser settings first, then
                          try again or choose &quot;I&apos;m not there anymore&quot; to pick a
                          spot on the map.
                        </Text>
                      ) : (
                        <Text size='xs' c='dimmed'>
                          Location not available (check browser permission or try again).
                        </Text>
                      )}
                    </Group>
                  )}
                  {stillAtLocation === 'no' && setLocationHint && (
                    <Stack gap='xs'>
                      <Text size='xs' c='dimmed'>
                        Click on the map to set the spot where you saw the turtle. You can
                        also type coordinates below.
                      </Text>
                      <MapPicker
                        height={isMobile ? 220 : 260}
                        value={
                          locationHint?.source === 'manual' ||
                          (locationHint && stillAtLocation === 'no')
                            ? { lat: locationHint.latitude, lon: locationHint.longitude }
                            : null
                        }
                        onChange={(lat, lon) => {
                          setManualLat(String(lat));
                          setManualLon(String(lon));
                          setLocationHint({
                            latitude: lat,
                            longitude: lon,
                            source: 'manual',
                          });
                        }}
                      />
                      <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <TextInput
                            size='xs'
                            label='Latitude'
                            placeholder='e.g. 52.52'
                            value={manualLat}
                            onChange={(e) => {
                              setManualLat(e.target.value);
                              const lat = parseFloat(e.target.value);
                              const lon = parseFloat(manualLon);
                              if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                                setLocationHint({
                                  latitude: lat,
                                  longitude: lon,
                                  source: 'manual',
                                });
                              } else {
                                setLocationHint(null);
                              }
                            }}
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <TextInput
                            size='xs'
                            label='Longitude'
                            placeholder='e.g. 13.405'
                            value={manualLon}
                            onChange={(e) => {
                              setManualLon(e.target.value);
                              const lat = parseFloat(manualLat);
                              const lon = parseFloat(e.target.value);
                              if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                                setLocationHint({
                                  latitude: lat,
                                  longitude: lon,
                                  source: 'manual',
                                });
                              } else {
                                setLocationHint(null);
                              }
                            }}
                          />
                        </Grid.Col>
                      </Grid>
                      {locationHint?.source === 'manual' && (
                        <Button
                          size='xs'
                          variant='subtle'
                          color='gray'
                          onClick={() => setLocationHint(null)}
                        >
                          Clear location
                        </Button>
                      )}
                    </Stack>
                  )}
                </Stack>
              </Stack>
            )}

            {uploadState === 'uploading' && (
              <Stack gap='xs' data-testid='upload-progress'>
                <Group justify='space-between'>
                  <Text size='sm' fw={500}>
                    {isGettingLocation ? 'Getting location...' : 'Uploading...'}
                  </Text>
                  <Text size='sm' c='dimmed'>
                    {uploadProgress}%
                  </Text>
                </Group>
                <Progress value={uploadProgress} size='lg' radius='xl' animated />
                <Center>
                  <Loader size='sm' />
                </Center>
                {isGettingLocation && (
                  <Text size='xs' c='dimmed' ta='center'>
                    Please allow location access to track turtle sightings
                  </Text>
                )}
              </Stack>
            )}

            {uploadState === 'success' && uploadResponse && (
              <Alert
                data-testid='upload-success-alert'
                icon={isDuplicate ? <IconClock size={18} /> : <IconCheck size={18} />}
                title={isDuplicate ? 'Duplicate Photo Detected' : 'Upload Successful!'}
                color={isDuplicate ? 'orange' : 'green'}
                radius='md'
              >
                {uploadResponse}
                {imageId && (
                  <Text size='xs' c='dimmed' mt='xs'>
                    Image ID: {imageId}
                  </Text>
                )}
                {isDuplicate && previousUploadDate && (
                  <Group gap='xs' mt='xs' align='flex-start'>
                    <IconClock size={14} style={{ marginTop: 2 }} />
                    <Text size='xs' c='dimmed'>
                      Previously uploaded on: {previousUploadDate}
                    </Text>
                  </Group>
                )}
                {!isDuplicate && (role === 'staff' || role === 'admin') && (
                  <Group gap='xs' mt='xs' align='flex-start'>
                    <IconSparkles size={14} style={{ marginTop: 2 }} />
                    <Text size='xs' c='dimmed'>
                      This is a new photo that has never been uploaded before
                    </Text>
                  </Group>
                )}
              </Alert>
            )}

            {uploadState === 'error' && uploadResponse && (
              <Alert
                icon={<IconAlertCircle size={18} />}
                title='Upload Failed'
                color='red'
                radius='md'
              >
                {uploadResponse}
              </Alert>
            )}

            <Group justify='flex-end' gap='sm'>
              {uploadState !== 'uploading' && (
                <>
                  {uploadState === 'idle' && (
                    <Button
                      onClick={onUpload}
                      leftSection={<IconCloudUpload size={18} />}
                      size='md'
                      fullWidth
                    >
                      Upload Photo
                    </Button>
                  )}
                  <Button
                    variant='light'
                    color='red'
                    onClick={onRemove}
                    leftSection={<IconTrash size={18} />}
                    size='md'
                    fullWidth={uploadState === 'idle'}
                  >
                    {uploadState === 'idle' ? 'Remove' : 'New Photo'}
                  </Button>
                </>
              )}
            </Group>
          </Stack>
        </Card>
      )}
    </Transition>
  );
}
