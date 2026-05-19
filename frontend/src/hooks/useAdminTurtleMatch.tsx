import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getReviewPacket,
  getTurtleImages,
  approveReview,
  createTurtleSheetsData,
  updateTurtleSheetsData,
  generatePrimaryId,
  getTurtleSheetsData,
  listSheets,
  crossCheckReviewPacket,
  type TurtleSheetsData,
  type FindMetadata,
  type ReviewQueueItem,
  type TurtleImagesResponse,
  type PhotoType,
} from '../services/api';
import { isStaffRole } from '../services/api/auth';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import type { TurtleSheetsDataFormRef } from '../components/TurtleSheetsDataForm';
import {
  lookupIdFromTurtleId,
  dataPathHintFromMatchLocation,
  candidateSummaryKey,
  type MatchData,
  type CrossCheckMatch,
  type CandidateSummary,
} from '../pages/AdminTurtleMatch/utils';

export type { MatchData, CrossCheckMatch, CandidateSummary };

export function useAdminTurtleMatch(
  role: string | undefined,
  authChecked: boolean,
  imageId: string | undefined,
) {
  const navigate = useNavigate();
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [packetItem, setPacketItem] = useState<ReviewQueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [sheetsData, setSheetsData] = useState<TurtleSheetsData | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [showNewTurtleModal, setShowNewTurtleModal] = useState(false);
  const [newTurtlePrimaryId, setNewTurtlePrimaryId] = useState<string | null>(null);
  const [newTurtleSheetsData, setNewTurtleSheetsData] = useState<TurtleSheetsData | null>(null);
  const [newTurtleSheetName, setNewTurtleSheetName] = useState('');
  const [newTurtleBackendPath, setNewTurtleBackendPath] = useState<string | undefined>();
  const [loadingTurtleData, setLoadingTurtleData] = useState(false);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [findMetadata] = useState<FindMetadata | null>(null);
  const [selectedMatchTurtleImages, setSelectedMatchTurtleImages] =
    useState<TurtleImagesResponse | null>(null);
  const [crossCheckResults, setCrossCheckResults] = useState<CrossCheckMatch[] | null>(null);
  const [candidateSummaries, setCandidateSummaries] = useState<
    Record<string, CandidateSummary>
  >({});
  const [crossCheckLoading, setCrossCheckLoading] = useState(false);
  const [replaceReference, setReplaceReference] = useState(false);
  const [replaceCarapaceReference, setReplaceCarapaceReference] = useState(false);
  const formRef = useRef<TurtleSheetsDataFormRef>(null);

  const selectedMatchData = selectedMatch && matchData
    ? matchData.matches.find((m) => m.turtle_id === selectedMatch)
    : undefined;

  const isMatchFromCommunity =
    selectedMatchData?.location?.startsWith('Community_Uploads') ?? false;

  const showDetail = !!(selectedMatch && selectedMatchData);

  const refreshPacketItem = useCallback(async () => {
    if (!imageId) return;
    try {
      const { item } = await getReviewPacket(imageId);
      setPacketItem(item);
    } catch {
      // ignore
    }
  }, [imageId]);

  const refreshSelectedMatchImages = useCallback(async () => {
    if (!selectedMatch || !selectedMatchData) return;
    const sheetNameHint = dataPathHintFromMatchLocation(selectedMatchData.location);
    const res = await getTurtleImages(selectedMatch, sheetNameHint);
    setSelectedMatchTurtleImages(res);
  }, [selectedMatch, selectedMatchData]);

  useEffect(() => {
    if (!selectedMatch || !selectedMatchData) {
      setSelectedMatchTurtleImages(null);
      return;
    }
    const sheetNameHint = dataPathHintFromMatchLocation(selectedMatchData.location);
    getTurtleImages(selectedMatch, sheetNameHint)
      .then(setSelectedMatchTurtleImages)
      .catch(() => setSelectedMatchTurtleImages(null));
  }, [selectedMatch, selectedMatchData]);

  useEffect(() => {
    const items: Array<{ turtleId: string; location: string }> = [];
    if (matchData?.matches) {
      for (const m of matchData.matches) {
        items.push({ turtleId: m.turtle_id, location: m.location || '' });
      }
    }
    if (crossCheckResults) {
      for (const m of crossCheckResults) {
        items.push({ turtleId: m.turtle_id, location: m.location || '' });
      }
    }
    if (items.length === 0) {
      setCandidateSummaries({});
      return;
    }
    const seen = new Set<string>();
    const unique = items.filter((it) => {
      const k = candidateSummaryKey(it.turtleId, it.location);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let cancelled = false;
    Promise.all(
      unique.map(async (it) => {
        const parts = (it.location || '').replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length === 0) return null;
        const isCommunity = parts[0] === 'Community_Uploads';
        const sheet = isCommunity ? (parts[1] || '') : parts[0];
        const stateArg = isCommunity ? 'Community_Uploads' : parts[0];
        const locArg = isCommunity ? (parts[1] || '') : parts.slice(1).join('/');
        if (!sheet) return null;
        try {
          const lookupId = lookupIdFromTurtleId(it.turtleId);
          const res = await getTurtleSheetsData(lookupId, sheet, stateArg, locArg);
          if (res.success && res.data) {
            return [
              candidateSummaryKey(it.turtleId, it.location),
              {
                primary_id: res.data.primary_id,
                name: res.data.name,
                bio_id: res.data.id,
              },
            ] as const;
          }
        } catch {
          /* ignore */
        }
        return null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, CandidateSummary> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setCandidateSummaries(map);
    });
    return () => {
      cancelled = true;
    };
  }, [matchData, crossCheckResults]);

  useEffect(() => {
    if (!authChecked || !isStaffRole(role)) return;
    listSheets()
      .then((res) => {
        if (res.success && res.sheets?.length) setAvailableSheets(res.sheets);
      })
      .catch(() => setAvailableSheets([]));
  }, [authChecked, role]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isStaffRole(role)) {
      navigate('/');
      return;
    }

    const loadMatchData = async () => {
      setLoading(true);
      try {
        if (imageId) {
          const stored = localStorage.getItem(`match_${imageId}`);
          if (stored) {
            let data: MatchData;
            try {
              data = JSON.parse(stored);
            } catch {
              console.error('Corrupted match data in localStorage, removing');
              localStorage.removeItem(`match_${imageId}`);
              setMatchData(null);
              setPacketItem(null);
              setLoading(false);
              return;
            }
            setMatchData(data);
            try {
              const { item } = await getReviewPacket(imageId);
              setPacketItem(item);
            } catch {
              setPacketItem(null);
            }
          } else {
            setMatchData(null);
            setPacketItem(null);
          }
        } else {
          setMatchData(null);
          setPacketItem(null);
        }
      } catch (error) {
        console.error('Error loading match data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMatchData();
  }, [imageId, authChecked, role, navigate]);

  const handleSelectMatch = async (turtleId: string) => {
    if (!turtleId) {
      setSelectedMatch(null);
      return;
    }
    setSelectedMatch(turtleId);
    setReplaceReference(false);
    setReplaceCarapaceReference(false);
    setSheetsData(null);
    setPrimaryId(turtleId);
    setLoadingTurtleData(true);

    const match = matchData?.matches.find((m) => m.turtle_id === turtleId);
    const matchLocation = match?.location || '';
    const locationParts = matchLocation.split('/');
    const matchState = locationParts[0] || '';
    const matchLocationSpecific = locationParts.slice(1).join('/') || '';

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 35000);

    try {
      const lookupId = lookupIdFromTurtleId(turtleId);
      let response: Awaited<ReturnType<typeof getTurtleSheetsData>>;
      if (matchState) {
        try {
          response = await getTurtleSheetsData(
            lookupId,
            matchState,
            matchState,
            matchLocationSpecific,
            abortController.signal,
          );
        } catch {
          response = await getTurtleSheetsData(
            lookupId,
            undefined,
            undefined,
            undefined,
            abortController.signal,
          );
        }
      } else {
        response = await getTurtleSheetsData(
          lookupId,
          undefined,
          undefined,
          undefined,
          abortController.signal,
        );
      }

      if (response.success && response.data) {
        if (response.exists) {
          setSheetsData(response.data);
          setPrimaryId(response.data.primary_id || turtleId);
        } else {
          setPrimaryId(turtleId);
          setSheetsData({ primary_id: turtleId });
        }
      } else {
        setPrimaryId(turtleId);
        setSheetsData({ primary_id: turtleId });
      }
    } catch {
      setPrimaryId(turtleId);
      setSheetsData({ primary_id: turtleId });
    } finally {
      window.clearTimeout(timeoutId);
      setLoadingTurtleData(false);
    }
  };

  const handleSaveSheetsData = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedMatch) throw new Error('No turtle selected');

    const match = matchData?.matches.find((m) => m.turtle_id === selectedMatch);
    if (!match) throw new Error('Match not found');

    const currentPrimaryId = primaryId || selectedMatch;

    if (isMatchFromCommunity) {
      await createTurtleSheetsData({
        sheet_name: sheetName,
        state: data.general_location ?? '',
        location: data.location ?? '',
        turtle_data: { ...data, primary_id: currentPrimaryId },
        target_spreadsheet: 'research',
      });
    } else {
      const locationParts = match.location.split('/');
      const state = locationParts.length >= 1 ? locationParts[0] : '';
      const location = locationParts.length >= 2 ? locationParts.slice(1).join('/') : '';
      await updateTurtleSheetsData(currentPrimaryId, {
        sheet_name: sheetName,
        state,
        location,
        turtle_data: data,
      });
    }

    setSheetsData(data);
  };

  const handleSaveAndConfirm = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedMatch || !imageId) throw new Error('Please select a match first');
    if (!matchData?.uploaded_image_path) throw new Error('Missing image path');

    setProcessing(true);
    try {
      await handleSaveSheetsData(data, sheetName);

      const currentPrimaryId = primaryId || selectedMatch;
      const communitySheetName = isMatchFromCommunity
        ? (selectedMatchData?.location?.split('/')[1]?.trim() || 'Unknown')
        : '';
      await approveReview(imageId, {
        match_turtle_id: selectedMatch,
        uploaded_image_path: matchData.uploaded_image_path,
        find_metadata: findMetadata ?? undefined,
        sheets_data: {
          ...data,
          primary_id: currentPrimaryId,
          sheet_name: sheetName,
          general_location: data.general_location ?? '',
        },
        match_from_community: isMatchFromCommunity,
        community_sheet_name: isMatchFromCommunity ? communitySheetName : undefined,
        photo_type: matchData.photo_type ?? 'plastron',
        replace_reference: replaceReference || undefined,
        replace_carapace_reference: replaceCarapaceReference || undefined,
      });

      localStorage.removeItem(`match_${imageId}`);

      notifications.show({
        title: 'Success!',
        message: 'Turtle data saved and match confirmed successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
      });

      navigate('/');
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to save and confirm',
        color: 'red',
      });
      throw error;
    } finally {
      setProcessing(false);
    }
  };

  const handleCombinedButtonClick = async () => {
    if (formRef.current) await formRef.current.submit();
  };

  const handleCreateNewTurtle = () => {
    setShowNewTurtleModal(true);
    setNewTurtlePrimaryId(null);
    setNewTurtleSheetsData(null);
    setNewTurtleSheetName('');
    setNewTurtleBackendPath(undefined);
  };

  const handleSaveNewTurtleSheetsData = async (
    data: TurtleSheetsData,
    sheetName: string,
    backendLocationPath?: string,
  ) => {
    setNewTurtleSheetsData(data);
    setNewTurtleSheetName(sheetName);
    setNewTurtleBackendPath(backendLocationPath);

    const state = data.general_location || '';
    const location = data.location || '';

    let generatedPrimaryId = newTurtlePrimaryId;
    if (!generatedPrimaryId) {
      try {
        const primaryIdResponse = await generatePrimaryId({ state, location });
        if (primaryIdResponse.success && primaryIdResponse.primary_id) {
          generatedPrimaryId = primaryIdResponse.primary_id;
          setNewTurtlePrimaryId(generatedPrimaryId);
        }
      } catch (error) {
        console.error('Error generating primary ID:', error);
      }
    }

    await handleConfirmNewTurtle(
      sheetName,
      data,
      backendLocationPath,
      generatedPrimaryId || undefined,
    );
  };

  const handleConfirmNewTurtle = async (
    sheetNameOverride?: string,
    sheetsDataOverride?: TurtleSheetsData,
    backendPathOverride?: string,
    primaryIdOverride?: string,
  ) => {
    const effectiveSheetName = sheetNameOverride || newTurtleSheetName;
    const effectiveSheetsData = sheetsDataOverride || newTurtleSheetsData;
    const effectiveBackendPath = backendPathOverride ?? newTurtleBackendPath;

    if (!effectiveSheetName) {
      notifications.show({
        title: 'Error',
        message: 'Please select a sheet for the new turtle',
        color: 'red',
      });
      return;
    }

    if (!imageId) {
      notifications.show({ title: 'Error', message: 'Missing image ID', color: 'red' });
      return;
    }

    if (!matchData?.uploaded_image_path) {
      notifications.show({ title: 'Error', message: 'Missing image path', color: 'red' });
      return;
    }

    setProcessing(true);
    const progressNotificationId = `new-turtle-${imageId}`;
    notifications.show({
      id: progressNotificationId,
      title: 'Creating turtle...',
      message: 'Saving to Google Sheets and rebuilding search index.',
      color: 'blue',
      loading: true,
      autoClose: false,
      withCloseButton: false,
    });

    try {
      const backendPathLocation = effectiveBackendPath ?? effectiveSheetName;
      const formState = effectiveSheetsData?.general_location || '';
      const formLocation = effectiveSheetsData?.location || '';
      const turtleState = formState || '';
      const turtleLocation = formLocation || '';

      let finalPrimaryId = primaryIdOverride || newTurtlePrimaryId;
      if (!finalPrimaryId) {
        try {
          const primaryIdResponse = await generatePrimaryId({
            state: turtleState,
            location: turtleLocation,
          });
          if (primaryIdResponse.success && primaryIdResponse.primary_id) {
            finalPrimaryId = primaryIdResponse.primary_id;
            setNewTurtlePrimaryId(finalPrimaryId);
          }
        } catch (error) {
          console.error('Error generating primary ID:', error);
        }
      }

      const bioIdForFolder = (effectiveSheetsData?.id || '').trim();
      const turtleIdForReview =
        bioIdForFolder && finalPrimaryId
          ? `${bioIdForFolder}_${finalPrimaryId}`
          : finalPrimaryId || `T${Date.now()}`;
      const isAdminUpload = imageId.startsWith('admin_');

      if (isAdminUpload && effectiveSheetsData) {
        await createTurtleSheetsData({
          sheet_name: effectiveSheetName,
          state: effectiveSheetsData.general_location || undefined,
          location: effectiveSheetsData.location || undefined,
          turtle_data: {
            ...effectiveSheetsData,
            primary_id: finalPrimaryId ?? undefined,
          },
        });
      }

      await approveReview(imageId, {
        new_location: backendPathLocation,
        new_turtle_id: turtleIdForReview,
        uploaded_image_path: matchData.uploaded_image_path,
        sheets_data: effectiveSheetsData
          ? {
              ...effectiveSheetsData,
              sheet_name: effectiveSheetName,
              primary_id: finalPrimaryId ?? undefined,
            }
          : undefined,
        photo_type: matchData?.photo_type ?? 'plastron',
      });

      localStorage.removeItem(`match_${imageId}`);

      notifications.update({
        id: progressNotificationId,
        title: 'Success!',
        message: 'New turtle created successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
        loading: false,
        autoClose: 1800,
        withCloseButton: true,
      });

      setShowNewTurtleModal(false);
      window.setTimeout(() => navigate('/'), 500);
    } catch (error) {
      notifications.update({
        id: progressNotificationId,
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create new turtle',
        color: 'red',
        loading: false,
        autoClose: 5000,
        withCloseButton: true,
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleCrossCheckCarapace = async () => {
    if (!imageId) return;
    setCrossCheckLoading(true);
    const carapaceImg = packetItem?.additional_images?.find((img) => img.type === 'carapace');
    try {
      const result = await crossCheckReviewPacket(
        imageId,
        'carapace' as PhotoType,
        carapaceImg?.image_path,
      );
      setCrossCheckResults(result.matches);
      if (result.matches.length === 0) {
        notifications.show({
          title: 'Cross-check',
          message: 'No carapace matches found',
          color: 'yellow',
        });
      }
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Cross-check failed',
        color: 'red',
      });
    } finally {
      setCrossCheckLoading(false);
    }
  };

  return {
    imageId,
    matchData,
    packetItem,
    loading,
    selectedMatch,
    selectedMatchData,
    processing,
    sheetsData,
    primaryId,
    showNewTurtleModal,
    setShowNewTurtleModal,
    newTurtlePrimaryId,
    newTurtleSheetsData,
    newTurtleSheetName,
    loadingTurtleData,
    availableSheets,
    formRef,
    selectedMatchTurtleImages,
    crossCheckResults,
    candidateSummaries,
    crossCheckLoading,
    replaceReference,
    setReplaceReference,
    replaceCarapaceReference,
    setReplaceCarapaceReference,
    isMatchFromCommunity,
    showDetail,
    navigate,
    handleSelectMatch,
    handleSaveSheetsData,
    handleSaveAndConfirm,
    handleCombinedButtonClick,
    handleCreateNewTurtle,
    handleSaveNewTurtleSheetsData,
    refreshPacketItem,
    refreshSelectedMatchImages,
    handleCrossCheckCarapace,
  };
}
