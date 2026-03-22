import {
  Container,
  Paper,
  Title,
  Text,
  Group,
  Stack,
  Button,
  Select,
  Loader,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import type { FileRejection, FileWithPath } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconUpload,
  IconX,
  IconPhoto,
  IconAlertCircle,
  IconCamera,
  IconInfoCircle,
} from '@tabler/icons-react';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { validateFile } from '../utils/fileValidation';
import { useUser } from '../hooks/useUser';
import { usePhotoUpload } from '../hooks/usePhotoUpload';
import { isStaffRole } from '../services/api/auth';
import { PreviewCard } from '../components/PreviewCard';
import { InstructionsModal } from '../components/InstructionsModal';
import { getLocations } from '../services/api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  recordCommunitySighting,
  clearPendingRewards,
  markTrainingCompleted,
} from '../store/slices/communityGameSlice';
import { SightingRewardsModal } from '../components/game/SightingRewardsModal';
import { ObserverHomeSummary } from '../components/game/ObserverHomeSummary';
import { ObserverGamificationTeaser } from '../components/game/ObserverGamificationTeaser';

const MATCH_ALL_VALUE = '__all__';
const SYSTEM_FOLDERS = ['Community_Uploads', 'Review_Queue', 'Incidental_Finds'];

export default function HomePage() {
  const dispatch = useAppDispatch();
  const pendingRewards = useAppSelector((s) => s.communityGame.pendingRewards);
  const { role, isLoggedIn, authChecked } = useUser();
  const isStaff = isStaffRole(role);
  const canUseObserverGamification = authChecked && isLoggedIn;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [instructionsOpened, setInstructionsOpened] = useState(false);
  // Admin: backend folder locations for match scope (State and State/Location)
  const [availableLocations, setAvailableLocations] = useState<string[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedMatchSheet, setSelectedMatchSheet] = useState<string>(MATCH_ALL_VALUE);

  // Auto-open instructions on first visit
  useEffect(() => {
    const hasSeenInstructions = localStorage.getItem('hasSeenInstructions');
    if (!hasSeenInstructions) {
      setInstructionsOpened(true);
    }
  }, []);

  // Staff/Admin: load backend locations (state and state/location) for match dropdown
  useEffect(() => {
    if (!isStaff) return;
    setLocationsLoading(true);
    getLocations()
      .then((res) => {
        if (!res.success || !res.locations?.length) {
          setAvailableLocations([]);
          return;
        }
        const paths = new Set<string>();
        for (const rawPath of res.locations as string[]) {
          const path = (rawPath || '').trim();
          const first = (path.split('/')[0] ?? '').trim();
          if (path && first && !SYSTEM_FOLDERS.includes(first)) {
            paths.add(path);
          }
        }
        const list = Array.from(paths).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
        setAvailableLocations(list);
        setSelectedMatchSheet((prev) => {
          if (prev !== MATCH_ALL_VALUE) return prev;
          const firstKansas = list.find((p) => p.startsWith('Kansas/'));
          const firstWithSlash = list.find((p) => p.includes('/'));
          return firstKansas || firstWithSlash || list[0] || MATCH_ALL_VALUE;
        });
      })
      .catch(() => setAvailableLocations([]))
      .finally(() => setLocationsLoading(false));
  }, [isStaff]);

  const matchScopeOptions = useMemo(() => {
    const byState = new Map<string, Set<string>>();

    for (const path of availableLocations) {
      const parts = path
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      const state = parts[0];
      if (!state) continue;
      if (!byState.has(state)) byState.set(state, new Set<string>());
      if (parts.length > 1) {
        byState.get(state)!.add(`${state}/${parts.slice(1).join('/')}`);
      }
    }

    const orderedStates = Array.from(byState.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
    const options: { value: string; label: string }[] = [];

    for (const state of orderedStates) {
      options.push({ value: state, label: state });
      if (state === 'Kansas') {
        const stateLocations = Array.from(byState.get(state) ?? []).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
        for (const loc of stateLocations) {
          options.push({ value: loc, label: loc });
        }
      }
    }

    options.push({ value: 'Community_Uploads', label: 'Community Turtles only' });
    options.push({ value: MATCH_ALL_VALUE, label: 'All locations (everything)' });
    return options;
  }, [availableLocations]);

  // Keep a real option selected: Mantine Select looks empty if `value` is missing from `data`.
  useEffect(() => {
    if (!isStaff || matchScopeOptions.length === 0) return;
    if (!matchScopeOptions.some((o) => o.value === selectedMatchSheet)) {
      setSelectedMatchSheet(matchScopeOptions[0].value);
    }
  }, [isStaff, matchScopeOptions, selectedMatchSheet]);

  const matchSheetForUpload = isStaff
    ? selectedMatchSheet === MATCH_ALL_VALUE
      ? ''
      : selectedMatchSheet
    : undefined;

  const onCommunitySightRecorded = useCallback(
    (meta: { hasGps: boolean; hasManual: boolean; extraPhotoCount: number }) => {
      if (!canUseObserverGamification) return;
      dispatch(recordCommunitySighting(meta));
    },
    [dispatch, canUseObserverGamification],
  );

  const {
    files,
    preview,
    uploadState,
    uploadProgress,
    uploadResponse,
    imageId,
    isDuplicate,
    previousUploadDate,
    isGettingLocation,
    locationPermissionDenied,
    locationHint,
    setLocationHint,
    requestLocationHint,
    collectedToLab,
    setCollectedToLab,
    physicalFlag,
    setPhysicalFlag,
    extraFiles,
    setExtraFiles,
    handleDrop,
    handleUpload,
    handleRemove,
  } = usePhotoUpload({
    role,
    matchSheet: matchSheetForUpload,
    onCommunitySightRecorded,
  });

  const handleDropWithValidation = (acceptedFiles: FileWithPath[]): void => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];

      // Validation
      const validation = validateFile(file);
      if (!validation.isValid) {
        notifications.show({
          title: 'Invalid File',
          message: validation.error || 'File could not be validated',
          color: 'red',
          icon: <IconAlertCircle size={18} />,
        });
        return;
      }

      handleDrop(acceptedFiles);
    }
  };

  const handleReject = (rejectedFiles: FileRejection[]): void => {
    const rejection = rejectedFiles[0];
    let message = 'File could not be accepted';

    if (rejection.errors[0]?.code === 'file-too-large') {
      message = 'File is too large. Maximum: 5MB';
    } else if (rejection.errors[0]?.code === 'file-invalid-type') {
      message = 'Invalid file type. Allowed: PNG, JPG, JPEG, GIF, WEBP';
    }

    notifications.show({
      title: 'Upload Rejected',
      message,
      color: 'orange',
      icon: <IconAlertCircle size={18} />,
    });
  };

  const handleCameraClick = (): void => {
    cameraInputRef.current?.click();
  };

  const handleFileSelectClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleCameraChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      // Convert File to FileWithPath for consistency
      const fileWithPath = Object.assign(file, { path: file.name }) as FileWithPath;
      handleDropWithValidation([fileWithPath]);
    }
    // Reset input so the same file can be selected again
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      // Convert File to FileWithPath for consistency
      const fileWithPath = Object.assign(file, { path: file.name }) as FileWithPath;
      handleDropWithValidation([fileWithPath]);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Container size='sm' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
        <Stack gap='lg'>
          {!isStaff && authChecked && !isLoggedIn && (
            <ObserverGamificationTeaser variant="home" />
          )}
          {!isStaff && canUseObserverGamification && <ObserverHomeSummary />}
          <Stack gap="xs" align="center">
            <Title order={1} ta="center">
              Photo Upload
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              {isStaff
                ? canUseObserverGamification
                  ? 'Upload a photo to save it in the backend and run a match. While logged in, successful uploads also count toward your Observer HQ progress.'
                  : 'Upload a photo to save it in the backend'
                : canUseObserverGamification
                  ? 'Submit a plastron sighting — your upload earns XP and counts toward Observer HQ quests'
                  : 'Submit a plastron sighting to support the project. Log in or create an account to earn XP and track Observer HQ progress.'}
            </Text>
            <Button
              variant="subtle"
              size="sm"
              c="dimmed"
              leftSection={<IconInfoCircle size={16} />}
              onClick={() => setInstructionsOpened(true)}
            >
              View instructions
            </Button>
          </Stack>

          {/* Staff/Admin: select which location (backend folder / state) to test against */}
          {isStaff && (
            <Stack gap='xs'>
              <Text size='sm' fw={500}>
                Which location to test against?
              </Text>
              {locationsLoading ? (
                <Group gap='xs'>
                  <Loader size='sm' />
                  <Text size='sm' c='dimmed'>
                    Loading locations…
                  </Text>
                </Group>
              ) : (
                <Select
                  data={matchScopeOptions}
                  value={selectedMatchSheet}
                  onChange={(v) => {
                    if (typeof v === 'string' && v.length > 0) setSelectedMatchSheet(v);
                  }}
                  placeholder={
                    availableLocations.length
                      ? 'Select state or location'
                      : 'No locations yet'
                  }
                  allowDeselect={false}
                  required
                  disabled={uploadState === 'uploading'}
                />
              )}
              <Text size='xs' c='dimmed'>
                Location: tested against that location, all Community Turtles and all
                Incidental Finds. &quot;Community Turtles only&quot;: only community
                uploads. &quot;All locations&quot;: everything (all locations, Community,
                Incidental Finds).
              </Text>
            </Stack>
          )}

          {/* Hidden file inputs for mobile */}
          <input
            ref={cameraInputRef}
            type='file'
            accept='image/*'
            capture='environment'
            style={{ display: 'none' }}
            onChange={handleCameraChange}
            disabled={uploadState === 'uploading'}
          />
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
            disabled={uploadState === 'uploading'}
          />

          {isMobile ? (
            <Stack gap='md'>
              <Button
                size='lg'
                leftSection={<IconCamera size={20} />}
                onClick={handleCameraClick}
                disabled={uploadState === 'uploading'}
                fullWidth
              >
                Take Photo
              </Button>
              <Button
                size='lg'
                variant='light'
                leftSection={<IconPhoto size={20} />}
                onClick={handleFileSelectClick}
                disabled={uploadState === 'uploading'}
                fullWidth
              >
                Upload Photo
              </Button>
              <Text size='sm' c='dimmed' ta='center' mt='xs'>
                Supported formats: PNG, JPG, JPEG, GIF, WEBP (max. 5MB)
              </Text>
            </Stack>
          ) : (
            <Dropzone
              onDrop={handleDropWithValidation}
              onReject={handleReject}
              maxSize={5 * 1024 * 1024} // 5MB
              accept={{
                'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
              }}
              multiple={false}
              disabled={uploadState === 'uploading'}
            >
              <Group
                justify='center'
                gap='xl'
                mih={220}
                style={{ pointerEvents: 'none' }}
              >
                <Dropzone.Accept>
                  <IconUpload size='3.2rem' stroke={1.5} />
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <IconX size='3.2rem' stroke={1.5} />
                </Dropzone.Reject>
                <Dropzone.Idle>
                  <IconPhoto size='3.2rem' stroke={1.5} />
                </Dropzone.Idle>

                <div>
                  <Text size='xl' inline ta='center'>
                    Drop photo here or click to select
                  </Text>
                  <Text
                    size='sm'
                    c='dimmed'
                    inline
                    mt={7}
                    ta='center'
                    style={{ display: 'block' }}
                  >
                    Supported formats: PNG, JPG, JPEG, GIF, WEBP (max. 5MB)
                  </Text>
                </div>
              </Group>
            </Dropzone>
          )}

          <PreviewCard
            preview={preview}
            files={files}
            uploadState={uploadState}
            uploadProgress={uploadProgress}
            uploadResponse={uploadResponse}
            imageId={imageId}
            isDuplicate={isDuplicate}
            previousUploadDate={previousUploadDate}
            isGettingLocation={isGettingLocation}
            locationPermissionDenied={locationPermissionDenied}
            role={role}
            locationHint={locationHint}
            setLocationHint={setLocationHint}
            requestLocationHint={requestLocationHint}
            collectedToLab={collectedToLab}
            setCollectedToLab={setCollectedToLab}
            physicalFlag={physicalFlag}
            setPhysicalFlag={setPhysicalFlag}
            extraFiles={extraFiles}
            setExtraFiles={setExtraFiles}
            onUpload={handleUpload}
            onRemove={handleRemove}
          />
        </Stack>
      </Paper>

      <InstructionsModal
        opened={instructionsOpened}
        onClose={() => setInstructionsOpened(false)}
        onTrainingCompleted={
          canUseObserverGamification ? () => dispatch(markTrainingCompleted()) : undefined
        }
      />

      {canUseObserverGamification && (
        <SightingRewardsModal
          opened={!!pendingRewards}
          rewards={pendingRewards}
          onClose={() => dispatch(clearPendingRewards())}
        />
      )}
    </Container>
  );
}
