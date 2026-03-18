import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type TurtleMatch,
  approveReview,
  updateTurtleSheetsData,
  createTurtleSheetsData,
  generatePrimaryId,
  getTurtleSheetsData,
  type TurtleSheetsData,
} from '../services/api';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import type { TurtleSheetsDataFormRef } from '../components/TurtleSheetsDataForm';
import { useAvailableSheets } from './useAvailableSheets';

export interface MatchData {
  request_id: string;
  uploaded_image_path: string;
  matches: TurtleMatch[];
}

export function useAdminTurtleMatch(
  role: string | undefined,
  authChecked: boolean,
  imageId: string | undefined,
) {
  const navigate = useNavigate();
  const { sheets: availableSheets } = useAvailableSheets(role);

  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [sheetsData, setSheetsData] = useState<TurtleSheetsData | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [showNewTurtleModal, setShowNewTurtleModal] = useState(false);
  const [newTurtlePrimaryId, setNewTurtlePrimaryId] = useState<string | null>(null);
  const [newTurtleSheetsData, setNewTurtleSheetsData] =
    useState<TurtleSheetsData | null>(null);
  const [newTurtleSheetName, setNewTurtleSheetName] = useState('');
  const [loadingTurtleData, setLoadingTurtleData] = useState(false);
  const formRef = useRef<TurtleSheetsDataFormRef>(null);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'staff' && role !== 'admin') {
      navigate('/');
      return;
    }

    const loadMatchData = () => {
      setLoading(true);
      try {
        if (imageId) {
          const stored = localStorage.getItem(`match_${imageId}`);
          if (stored) {
            const data: MatchData = JSON.parse(stored);
            setMatchData(data);
          }
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
    setSelectedMatch(turtleId);
    setLoadingTurtleData(true);

    const match = matchData?.matches.find((m) => m.turtle_id === turtleId);
    const matchLocation = match?.location || '';
    const locationParts = matchLocation.split('/');
    const matchState = locationParts[0] || '';
    const matchLocationSpecific = locationParts.slice(1).join('/') || '';

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 35000);

    try {
      let response: Awaited<ReturnType<typeof getTurtleSheetsData>>;
      if (matchState) {
        try {
          response = await getTurtleSheetsData(
            turtleId,
            matchState,
            matchState,
            matchLocationSpecific,
            abortController.signal,
          );
        } catch {
          response = await getTurtleSheetsData(turtleId, undefined, undefined, undefined, abortController.signal);
        }
      } else {
        response = await getTurtleSheetsData(turtleId, undefined, undefined, undefined, abortController.signal);
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

    const locationParts = match.location.split('/');
    const state = locationParts.length >= 1 ? locationParts[0] : '';
    const location = locationParts.length >= 2 ? locationParts.slice(1).join('/') : '';
    const currentPrimaryId = primaryId || selectedMatch;

    await updateTurtleSheetsData(currentPrimaryId, {
      sheet_name: sheetName,
      state,
      location,
      turtle_data: data,
    });

    setSheetsData(data);
  };

  const handleSaveAndConfirm = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedMatch || !imageId) throw new Error('Please select a match first');
    if (!matchData?.uploaded_image_path) throw new Error('Missing image path');

    setProcessing(true);
    try {
      await handleSaveSheetsData(data, sheetName);
      await approveReview(imageId, {
        match_turtle_id: selectedMatch,
        uploaded_image_path: matchData.uploaded_image_path,
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
  };

  const handleSaveNewTurtleSheetsData = async (
    data: TurtleSheetsData,
    sheetName: string,
  ) => {
    setNewTurtleSheetsData(data);
    setNewTurtleSheetName(sheetName);
    const state = data.general_location || '';
    const location = data.location || '';
    let primaryIdVal = newTurtlePrimaryId;
    if (!primaryIdVal) {
      try {
        const res = await generatePrimaryId({ state, location });
        if (res.success && res.primary_id) {
          primaryIdVal = res.primary_id;
          setNewTurtlePrimaryId(primaryIdVal);
        }
      } catch (error) {
        console.error('Error generating primary ID:', error);
      }
    }
    await handleConfirmNewTurtle(sheetName, data);
  };

  const handleConfirmNewTurtle = async (
    sheetNameOverride?: string,
    sheetsDataOverride?: TurtleSheetsData,
  ) => {
    const effectiveSheetName = sheetNameOverride || newTurtleSheetName;
    const effectiveSheetsData = sheetsDataOverride || newTurtleSheetsData;

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
      notifications.show({
        title: 'Error',
        message: 'Missing image path',
        color: 'red',
      });
      return;
    }

    setProcessing(true);
    try {
      const formState = effectiveSheetsData?.general_location || '';
      const formLocation = effectiveSheetsData?.location || '';
      const turtleState = formState || '';
      const turtleLocation = formLocation || '';
      let finalPrimaryId = newTurtlePrimaryId;
      if (!finalPrimaryId) {
        try {
          const res = await generatePrimaryId({
            state: turtleState,
            location: turtleLocation,
          });
          if (res.success && res.primary_id) {
            finalPrimaryId = res.primary_id;
            setNewTurtlePrimaryId(finalPrimaryId);
          }
        } catch (error) {
          console.error('Error generating primary ID:', error);
        }
      }

      let sheetsDataCreated = false;
      if (effectiveSheetsData && finalPrimaryId && effectiveSheetName) {
        try {
          const result = await createTurtleSheetsData({
            sheet_name: effectiveSheetName,
            state: turtleState,
            location: turtleLocation,
            turtle_data: {
              ...effectiveSheetsData,
              primary_id: finalPrimaryId,
              general_location: effectiveSheetsData?.general_location ?? '',
              location: effectiveSheetsData?.location ?? '',
            },
          });
          sheetsDataCreated = result.success ?? false;
        } catch {
          notifications.show({
            title: 'Warning',
            message:
              'Failed to create turtle in Google Sheets. Backend will create it as fallback.',
            color: 'yellow',
          });
        }
      }

      const turtleIdForReview = finalPrimaryId || `T${Date.now()}`;
      await approveReview(imageId, {
        new_location: effectiveSheetName,
        new_turtle_id: turtleIdForReview,
        uploaded_image_path: matchData.uploaded_image_path,
        sheets_data: effectiveSheetsData
          ? {
              ...effectiveSheetsData,
              sheet_name: effectiveSheetName,
              primary_id: sheetsDataCreated ? (finalPrimaryId ?? undefined) : undefined,
            }
          : undefined,
      });

      localStorage.removeItem(`match_${imageId}`);
      notifications.show({
        title: 'Success!',
        message: 'New turtle created successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
      });
      setShowNewTurtleModal(false);
      navigate('/');
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create new turtle',
        color: 'red',
      });
    } finally {
      setProcessing(false);
    }
  };

  const selectedMatchData = selectedMatch
    ? matchData?.matches.find((m) => m.turtle_id === selectedMatch)
    : null;
  const locationParts = selectedMatchData?.location.split('/') || [];
  const state = locationParts[0] || '';
  const location = locationParts.slice(1).join('/') || '';

  return {
    matchData,
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
    state,
    location,
    navigate,
    handleSelectMatch,
    handleSaveSheetsData,
    handleSaveAndConfirm,
    handleCombinedButtonClick,
    handleCreateNewTurtle,
    handleSaveNewTurtleSheetsData,
    handleConfirmNewTurtle,
  };
}
