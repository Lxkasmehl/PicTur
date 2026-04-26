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
  Modal,
  ActionIcon,
} from '@mantine/core';
import type { ComboboxData, ComboboxItem, ComboboxItemGroup } from '@mantine/core';
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
  IconSkull,
  IconStar,
  IconStarFilled,
} from '@tabler/icons-react';
import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { validateFile } from '../utils/fileValidation';
import { useUser } from '../hooks/useUser';
import { usePhotoUpload } from '../hooks/usePhotoUpload';
import { isStaffRole } from '../services/api/auth';
import { PreviewCard } from '../components/PreviewCard';
import { InstructionsModal } from '../components/InstructionsModal';
import {
  getLocations,
  fetchUserUiPreferences,
  saveUserUiPreferences,
} from '../services/api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  recordCommunitySighting,
  clearPendingRewards,
  markTrainingCompleted,
} from '../store/slices/communityGameSlice';
import { SightingRewardsModal } from '../components/game/SightingRewardsModal';
import { ObserverHomeSummary } from '../components/game/ObserverHomeSummary';
import { ObserverGamificationTeaser } from '../components/game/ObserverGamificationTeaser';
import { MarkDeceasedPanel } from '../components/MarkDeceasedPanel';
import {
  loadHomeMatchScopeFavorites,
  saveHomeMatchScopeFavorites,
} from '../utils/homeMatchScopeFavorites';

const MATCH_ALL_VALUE = '__all__';
const SYSTEM_FOLDERS = ['Community_Uploads', 'Review_Queue', 'Incidental_Finds', 'Incidental Places', 'benchmarks'];

function isComboboxItemGroup(x: ComboboxData[number]): x is ComboboxItemGroup {
  return typeof x === 'object' && x !== null && 'group' in x && 'items' in x;
}

/** Flatten grouped Select data for validation / value checks. */
function flattenMatchScopeOptions(data: ComboboxData): ComboboxItem[] {
  const out: ComboboxItem[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') {
      out.push({ value: entry, label: entry });
      continue;
    }
    if (isComboboxItemGroup(entry)) {
      for (const it of entry.items) {
        if (typeof it === 'string') out.push({ value: it, label: it });
        else out.push(it);
      }
      continue;
    }
    out.push(entry);
  }
  return out;
}

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
  const [markDeceasedModalOpen, setMarkDeceasedModalOpen] = useState(false);
  // Admin: backend folder locations for match scope (State and State/Location)
  const [availableLocations, setAvailableLocations] = useState<string[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedMatchSheet, setSelectedMatchSheet] = useState<string>(MATCH_ALL_VALUE);
  const [favoriteLocations, setFavoriteLocations] = useState<string[]>([]);
  /** Staff + logged in: wait for GET /user-ui-preferences before applying match-scope defaults. */
  const [matchScopePrefsHydrated, setMatchScopePrefsHydrated] = useState(false);

  // Before first paint as staff: mark locations as loading so match-scope init does not
  // commit "All locations" while GET /locations is still in flight (same tick as useEffect).
  useLayoutEffect(() => {
    if (isStaff) {
      setLocationsLoading(true);
    } else {
      setLocationsLoading(false);
    }
  }, [isStaff]);

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
      })
      .catch(() => setAvailableLocations([]))
      .finally(() => setLocationsLoading(false));
  }, [isStaff]);

  // Load favorites: auth profile when logged in (staff), else local cache.
  useEffect(() => {
    if (!authChecked) return;
    if (!isStaff) {
      setFavoriteLocations(loadHomeMatchScopeFavorites());
      setMatchScopePrefsHydrated(true);
      return;
    }
    if (!isLoggedIn) {
      setFavoriteLocations(loadHomeMatchScopeFavorites());
      setMatchScopePrefsHydrated(true);
      return;
    }

    let cancelled = false;
    setMatchScopePrefsHydrated(false);
    void fetchUserUiPreferences()
      .then((prefs) => {
        if (cancelled) return;
        let list = prefs?.homeMatchScopeFavorites ?? [];
        if (list.length === 0) {
          const local = loadHomeMatchScopeFavorites();
          if (local.length > 0) {
            list = local;
            void saveUserUiPreferences({ homeMatchScopeFavorites: list }).catch(() => {});
          }
        }
        setFavoriteLocations(list);
        saveHomeMatchScopeFavorites(list);
      })
      .catch(() => {
        if (cancelled) return;
        const local = loadHomeMatchScopeFavorites();
        setFavoriteLocations(local);
      })
      .finally(() => {
        if (!cancelled) setMatchScopePrefsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, isStaff, isLoggedIn]);

  const canonicalMatchScopeOptions = useMemo(() => {
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
    const options: ComboboxItem[] = [];

    for (const state of orderedStates) {
      const stateLocations = Array.from(byState.get(state) ?? []).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      );
      options.push({ value: state, label: state });
      // Only expand sub-locations when a state has multiple locations.
      // Single-location states (e.g. NebraskaCPBS with just CPBS) don't
      // need a redundant child entry — the state-level prefix match covers it.
      if (stateLocations.length > 1) {
        for (const loc of stateLocations) {
          options.push({ value: loc, label: `  ${loc.split('/').slice(1).join('/')}` });
        }
      }
    }

    options.push({ value: 'Community_Uploads', label: 'Community Turtles only' });
    options.push({ value: MATCH_ALL_VALUE, label: 'All locations (everything)' });
    return options;
  }, [availableLocations]);

  const matchScopeOptions = useMemo((): ComboboxData => {
    const canonical = canonicalMatchScopeOptions;
    const validIds = new Set(canonical.map((o) => o.value));
    const seen = new Set<string>();
    const favoriteOrdered: ComboboxItem[] = [];
    for (const v of favoriteLocations) {
      if (!validIds.has(v) || seen.has(v)) continue;
      seen.add(v);
      const item = canonical.find((o) => o.value === v);
      if (item) favoriteOrdered.push(item);
    }
    const rest = canonical.filter((o) => !seen.has(o.value));
    if (favoriteOrdered.length === 0) {
      return rest;
    }
    return [
      { group: 'Favorites', items: favoriteOrdered },
      { group: 'More locations', items: rest },
    ];
  }, [canonicalMatchScopeOptions, favoriteLocations]);

  const matchScopeFlatOptions = useMemo(
    () => flattenMatchScopeOptions(matchScopeOptions),
    [matchScopeOptions],
  );

  useEffect(() => {
    if (!matchScopePrefsHydrated) return;
    saveHomeMatchScopeFavorites(favoriteLocations);
    if (!isStaff || !isLoggedIn) return;
    const t = window.setTimeout(() => {
      void saveUserUiPreferences({ homeMatchScopeFavorites: favoriteLocations }).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [favoriteLocations, matchScopePrefsHydrated, isStaff, isLoggedIn]);

  const matchScopeSelectionReady = useRef(false);

  useEffect(() => {
    if (!isStaff) matchScopeSelectionReady.current = false;
  }, [isStaff]);

  useEffect(() => {
    if (matchScopePrefsHydrated) {
      matchScopeSelectionReady.current = false;
    }
  }, [matchScopePrefsHydrated]);

  // Drop favorites that no longer exist on the server (paths removed).
  // While GET /locations is in flight, canonical options omit real folders — do not prune yet
  // or we strip saved favorites (e.g. Kansas) before paths are known.
  useEffect(() => {
    if (!isStaff || locationsLoading || canonicalMatchScopeOptions.length === 0) return;
    const validIds = new Set(canonicalMatchScopeOptions.map((o) => o.value));
    setFavoriteLocations((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [isStaff, locationsLoading, canonicalMatchScopeOptions]);

  // First time real folder locations are known: default to all locations, or first saved favorite.
  useEffect(() => {
    if (!isStaff || !matchScopePrefsHydrated || matchScopeFlatOptions.length === 0 || matchScopeSelectionReady.current)
      return;

    // Wait for folder list: prefs often resolve before GET /locations; without this we lock
    // "All locations" and/or prune favorites while Kansas is not in `data` yet.
    if (locationsLoading) return;

    if (availableLocations.length === 0) {
      const validIds = new Set(matchScopeFlatOptions.map((o) => o.value));
      const validFavs = favoriteLocations.filter((f) => validIds.has(f));
      setSelectedMatchSheet(validFavs.length > 0 ? validFavs[0] : MATCH_ALL_VALUE);
      matchScopeSelectionReady.current = true;
      return;
    }

    const validIds = new Set(matchScopeFlatOptions.map((o) => o.value));
    const validFavs = favoriteLocations.filter((f) => validIds.has(f));
    setSelectedMatchSheet(validFavs.length > 0 ? validFavs[0] : MATCH_ALL_VALUE);
    matchScopeSelectionReady.current = true;
  }, [
    isStaff,
    matchScopePrefsHydrated,
    locationsLoading,
    availableLocations.length,
    matchScopeFlatOptions,
    favoriteLocations,
  ]);

  // Keep selection valid when options or favorites change after init.
  useEffect(() => {
    if (!isStaff || !matchScopePrefsHydrated || matchScopeFlatOptions.length === 0 || !matchScopeSelectionReady.current)
      return;
    const validIds = new Set(matchScopeFlatOptions.map((o) => o.value));
    const validFavs = favoriteLocations.filter((f) => validIds.has(f));

    setSelectedMatchSheet((prev) => {
      if (!validIds.has(prev)) {
        if (validFavs.length > 0) return validFavs[0];
        return MATCH_ALL_VALUE;
      }
      if (validFavs.length === 0) return prev;
      if (prev === MATCH_ALL_VALUE) return prev;
      if (validFavs.includes(prev)) return prev;
      return validFavs[0];
    });
  }, [isStaff, matchScopePrefsHydrated, matchScopeFlatOptions, favoriteLocations]);

  const toggleMatchScopeFavorite = useCallback((value: string) => {
    setFavoriteLocations((prev) => {
      const exists = prev.includes(value);
      if (exists) return prev.filter((v) => v !== value);
      queueMicrotask(() => setSelectedMatchSheet(value));
      return [value, ...prev.filter((v) => v !== value)];
    });
  }, []);

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
      message = 'Invalid file type. Allowed: PNG, JPG, JPEG, GIF, WEBP, HEIC';
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
            <Group justify="center" gap="sm" wrap="wrap">
              <Button
                variant="subtle"
                size="sm"
                c="dimmed"
                leftSection={<IconInfoCircle size={16} />}
                onClick={() => setInstructionsOpened(true)}
              >
                View instructions
              </Button>
              {isStaff && (
                <Button
                  variant="subtle"
                  size="sm"
                  c="dimmed"
                  leftSection={<IconSkull size={16} stroke={1.5} />}
                  onClick={() => setMarkDeceasedModalOpen(true)}
                >
                  Mortality without plastron ID
                </Button>
              )}
            </Group>
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
                  renderOption={({ option }) => {
                    const isFav = favoriteLocations.includes(option.value);
                    return (
                      <Group justify='space-between' gap='xs' wrap='nowrap' w='100%'>
                        <Text size='sm' style={{ flex: 1, minWidth: 0 }}>
                          {option.label}
                        </Text>
                        <ActionIcon
                          type='button'
                          variant='subtle'
                          size='sm'
                          aria-label={
                            isFav ? 'Remove from match-scope favorites' : 'Add to match-scope favorites'
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleMatchScopeFavorite(option.value);
                          }}
                        >
                          {isFav ? (
                            <IconStarFilled size={16} color='var(--mantine-color-yellow-5)' />
                          ) : (
                            <IconStar size={16} />
                          )}
                        </ActionIcon>
                      </Group>
                    );
                  }}
                />
              )}
              <Text size='xs' c='dimmed'>
                Location: tested against that location, all Community Turtles and all
                Incidental Finds. &quot;Community Turtles only&quot;: only community
                uploads. &quot;All locations&quot;: everything (all locations, Community,
                Incidental Finds). Use the star to pin rows to the top (saved to your
                account when logged in, with a local fallback); starring selects that
                scope unless you choose another option.
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
                Supported formats: PNG, JPG, JPEG, GIF, WEBP, HEIC (max. 5MB)
              </Text>
            </Stack>
          ) : (
            <Dropzone
              onDrop={handleDropWithValidation}
              onReject={handleReject}
              maxSize={5 * 1024 * 1024} // 5MB
              accept={{
                'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif'],
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
                    Supported formats: PNG, JPG, JPEG, GIF, WEBP, HEIC (max. 5MB)
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

      <Modal
        opened={markDeceasedModalOpen}
        onClose={() => setMarkDeceasedModalOpen(false)}
        title={
          <Group gap="sm" wrap="nowrap">
            <IconSkull size={22} stroke={1.5} />
            <span>Mortality without plastron match</span>
          </Group>
        }
        size="lg"
        centered
      >
        <MarkDeceasedPanel embedded />
      </Modal>

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
