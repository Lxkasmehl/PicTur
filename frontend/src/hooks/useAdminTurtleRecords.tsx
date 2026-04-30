import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getReviewQueue,
  getReviewPacket,
  approveReview,
  deleteReviewItem,
  getTurtleSheetsData,
  type ReviewQueueItem,
  updateTurtleSheetsData,
  createTurtleSheetsData,
  generatePrimaryId,
  listAllTurtlesFromSheets,
  type TurtleSheetsData,
} from '../services/api';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import type { TurtleSheetsDataFormRef } from '../components/TurtleSheetsDataForm';
import { useAvailableSheets } from './useAvailableSheets';

export function useAdminTurtleRecords(role: string | undefined, authChecked: boolean) {
  const navigate = useNavigate();
  const { sheets: availableSheets, loading: sheetsListLoading } =
    useAvailableSheets(role);
  const [activeTab, setActiveTab] = useState<string>('queue');

  // Review Queue State
  const [queueItems, setQueueItems] = useState<ReviewQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [sheetsData, setSheetsData] = useState<TurtleSheetsData | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [loadingTurtleData, setLoadingTurtleData] = useState(false);
  const [candidateNames, setCandidateNames] = useState<Record<string, string>>({});
  const [candidateOriginalIds, setCandidateOriginalIds] = useState<
    Record<string, string>
  >({});
  const [loadingCandidateNames, setLoadingCandidateNames] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ReviewQueueItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sheetsFormRef = useRef<TurtleSheetsDataFormRef>(null);

  // Create new turtle (review queue)
  const [showNewTurtleModal, setShowNewTurtleModal] = useState(false);
  const [newTurtlePrimaryId, setNewTurtlePrimaryId] = useState<string | null>(null);
  const [newTurtleSheetsData, setNewTurtleSheetsData] =
    useState<TurtleSheetsData | null>(null);
  const [newTurtleSheetName, setNewTurtleSheetName] = useState('');

  // Google Sheets Browser State
  const [allTurtles, setAllTurtles] = useState<TurtleSheetsData[]>([]);
  const [turtlesLoading, setTurtlesLoading] = useState(false);
  const [selectedTurtle, setSelectedTurtle] = useState<TurtleSheetsData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSheetFilter, setSelectedSheetFilter] = useState<string>('');
  const queueInitialLoadDone = useRef(false);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'staff' && role !== 'admin') {
      navigate('/');
      return;
    }

    if (activeTab === 'queue') {
      queueInitialLoadDone.current = false;
      loadQueue();
      const interval = setInterval(loadQueue, 30000);
      return () => clearInterval(interval);
    } else if (activeTab === 'sheets') {
      loadAllTurtles(selectedSheetFilter || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when tab changes
  }, [authChecked, role, navigate, activeTab]);

  const loadQueue = async () => {
    const isInitial = !queueInitialLoadDone.current;
    if (isInitial) setQueueLoading(true);
    try {
      const response = await getReviewQueue();
      setQueueItems(response.items);
      setSelectedItem((prev) => {
        if (!prev) return prev;
        const updated = response.items.find((i) => i.request_id === prev.request_id);
        return updated ?? prev;
      });
      queueInitialLoadDone.current = true;
    } catch (error) {
      console.error('Error loading review queue:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to load review queue',
        color: 'red',
      });
    } finally {
      if (isInitial) setQueueLoading(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'staff' && role !== 'admin') return;
    if (activeTab !== 'queue') return;
    if (!queueItems.some((i) => i.match_search_pending)) return;
    const id = window.setInterval(() => {
      void loadQueue();
    }, 5000);
    return () => window.clearInterval(id);
  }, [authChecked, role, activeTab, queueItems]);

  const refreshQueueItem = async (requestId: string) => {
    try {
      const { item } = await getReviewPacket(requestId);
      setQueueItems((prev) =>
        prev.map((it) => (it.request_id === requestId ? item : it)),
      );
      setSelectedItem((prev) => {
        if (prev?.request_id === requestId) {
          // Candidates may have changed (e.g. after classify) — clear stale state
          setSelectedCandidate(null);
          setCandidateNames({});
          setCandidateOriginalIds({});
          setSheetsData(null);
          setPrimaryId(null);
          // Reload candidate names for the fresh candidate set
          if (item.candidates?.length) {
            loadCandidateNames(item);
          }
          return item;
        }
        return prev;
      });
    } catch (error) {
      console.error('Error refreshing queue item:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to refresh item',
        color: 'red',
      });
    }
  };

  const loadAllTurtles = async (sheetFilter?: string) => {
    const sheetToLoad = sheetFilter !== undefined ? sheetFilter : selectedSheetFilter;
    setTurtlesLoading(true);
    try {
      const response = await listAllTurtlesFromSheets(sheetToLoad || undefined);
      if (response.success) {
        setAllTurtles(response.turtles);
      }
    } catch (error) {
      console.error('Error loading turtles:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to load turtles',
        color: 'red',
      });
    } finally {
      setTurtlesLoading(false);
    }
  };

  const handleItemSelect = (item: ReviewQueueItem, candidateId?: string) => {
    const isNewItem = item.request_id !== selectedItem?.request_id;
    setSelectedItem(item);
    setSelectedCandidate(candidateId || null);
    setSheetsData(null);
    setPrimaryId(null);
    if (isNewItem) {
      setCandidateNames({});
      setCandidateOriginalIds({});
    }

    if (candidateId) {
      loadSheetsDataForCandidate(item, candidateId);
    }
    if (isNewItem) loadCandidateNames(item);
  };

  const loadCandidateNames = async (item: ReviewQueueItem) => {
    if (!item.candidates?.length) return;
    setLoadingCandidateNames(true);
    const matchState = item.metadata.state || '';
    const matchLocation = item.metadata.location || '';
    const names: Record<string, string> = {};
    const originalIds: Record<string, string> = {};
    await Promise.all(
      item.candidates.map(async (c) => {
        try {
          let res = await getTurtleSheetsData(c.turtle_id);
          if (
            !res.exists &&
            matchState &&
            (!res.data || Object.keys(res.data || {}).length <= 3)
          ) {
            try {
              res = await getTurtleSheetsData(
                c.turtle_id,
                matchState,
                matchState,
                matchLocation,
              );
            } catch {
              // ignore
            }
          }
          if (res.success && res.data) {
            if (res.data.name) names[c.turtle_id] = res.data.name;
            if (res.data.id) originalIds[c.turtle_id] = res.data.id;
          }
        } catch {
          // leave name/id empty
        }
      }),
    );
    setCandidateNames(names);
    setCandidateOriginalIds(originalIds);
    setLoadingCandidateNames(false);
  };

  const loadSheetsDataForCandidate = async (
    item: ReviewQueueItem,
    candidateId: string,
  ) => {
    setLoadingTurtleData(true);

    const matchState = item.metadata.state || '';
    const matchLocation = item.metadata.location || '';

    try {
      let response = await getTurtleSheetsData(candidateId);

      if (
        !response.exists &&
        matchState &&
        (!response.data || Object.keys(response.data).length <= 3)
      ) {
        try {
          response = await getTurtleSheetsData(
            candidateId,
            matchState,
            matchState,
            matchLocation,
          );
        } catch {
          // Ignore, use first response
        }
      }

      if (response.success && response.data) {
        const hasRealData =
          response.exists ||
          !!(
            response.data.name ||
            response.data.species ||
            response.data.sex ||
            response.data.transmitter_id ||
            response.data.sheet_name ||
            response.data.date_1st_found ||
            response.data.notes ||
            Object.keys(response.data).length > 3
          );

        if (hasRealData) {
          setSheetsData(response.data);
          setPrimaryId(response.data.primary_id || candidateId);
          if (response.data.name) {
            setCandidateNames((prev) => ({
              ...prev,
              [candidateId]: response.data!.name!,
            }));
          }
          if (response.data.id) {
            setCandidateOriginalIds((prev) => ({
              ...prev,
              [candidateId]: response.data!.id!,
            }));
          }
        } else {
          setPrimaryId(candidateId);
          setSheetsData({
            id: candidateId,
          });
        }
      } else {
        setPrimaryId(candidateId);
        setSheetsData({
          id: candidateId,
        });
      }
    } catch {
      setPrimaryId(candidateId);
      setSheetsData({
        id: candidateId,
      });
    } finally {
      setLoadingTurtleData(false);
    }
  };

  const handleSaveSheetsData = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedItem || !selectedCandidate) {
      throw new Error('No turtle selected');
    }

    const state = selectedItem.metadata.state || '';
    const location = selectedItem.metadata.location || '';
    const currentPrimaryId = primaryId || selectedCandidate;
    const isCommunityUpload = !selectedItem.request_id?.startsWith('admin_');

    await updateTurtleSheetsData(currentPrimaryId, {
      sheet_name: sheetName,
      state,
      location,
      turtle_data: data,
      target_spreadsheet: isCommunityUpload ? 'community' : 'research',
    });

    setSheetsData(data);
  };

  const handleSaveTurtleFromBrowser = async (
    data: TurtleSheetsData,
    sheetName: string,
  ) => {
    if (!selectedTurtle) {
      throw new Error('No turtle selected');
    }

    const primaryIdVal = selectedTurtle.primary_id || selectedTurtle.id;
    const state = selectedTurtle.general_location || '';
    const location = selectedTurtle.location || '';

    if (!primaryIdVal) {
      throw new Error('Missing primary ID');
    }

    await updateTurtleSheetsData(primaryIdVal, {
      sheet_name: sheetName,
      state,
      location,
      turtle_data: data,
    });

    await loadAllTurtles();
    setSelectedTurtle({ ...data, primary_id: primaryIdVal, sheet_name: sheetName });
  };

  const handleSaveAndApprove = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedItem || !selectedCandidate) {
      throw new Error('No turtle selected');
    }
    setProcessing(selectedItem.request_id);
    try {
      // Verify the review item still exists before committing
      try {
        await getReviewPacket(selectedItem.request_id);
      } catch {
        throw new Error('This review item has already been processed by another admin. Please go back to the queue.');
      }
      await handleSaveSheetsData(data, sheetName);
      await approveReview(selectedItem.request_id, {
        match_turtle_id: selectedCandidate,
        photo_type: selectedItem.photo_type ?? 'plastron',
      });
      notifications.show({
        title: 'Success!',
        message: 'Saved to Sheets and match approved',
        color: 'green',
        icon: <IconCheck size={18} />,
      });
      setQueueItems((prev) =>
        prev.filter((i) => i.request_id !== selectedItem.request_id),
      );
      setSelectedItem(null);
      setSelectedCandidate(null);
      setSheetsData(null);
      setPrimaryId(null);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to save and approve',
        color: 'red',
      });
      throw error;
    } finally {
      setProcessing(null);
    }
  };

  const handleCombinedButtonClick = async () => {
    if (sheetsFormRef.current) {
      await sheetsFormRef.current.submit();
    }
  };

  const handleCreateNewTurtle = () => {
    setShowNewTurtleModal(true);
    setNewTurtlePrimaryId(null);
    setNewTurtleSheetsData(null);
    setNewTurtleSheetName('');
  };

  const handleConfirmNewTurtle = async (
    sheetNameOverride?: string,
    sheetsDataOverride?: TurtleSheetsData,
  ) => {
    if (!selectedItem) return;
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
    setProcessing(selectedItem.request_id);
    try {
      const formState = effectiveSheetsData?.general_location || '';
      const formLocation = effectiveSheetsData?.location || '';
      const turtleState = formState || '';
      const turtleLocation = formLocation || '';
      let finalPrimaryId = newTurtlePrimaryId;
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
      const isCommunityUpload = !selectedItem.request_id?.startsWith('admin_');
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
            target_spreadsheet: isCommunityUpload ? 'community' : 'research',
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
      // Verify the review item still exists before committing
      try {
        await getReviewPacket(selectedItem.request_id);
      } catch {
        throw new Error('This review item has already been processed by another admin. Please go back to the queue.');
      }
      const turtleIdForReview = finalPrimaryId || `T${Date.now()}`;
      // Admin: backend path = data/State/Location/PrimaryID (Location = general_location). Community: data/Community_Uploads/Sheet/.
      const generalLoc = effectiveSheetsData?.general_location?.trim() ?? '';
      const newLocation =
        isCommunityUpload
          ? effectiveSheetName
          : generalLoc
            ? `${effectiveSheetName}/${generalLoc}`
            : effectiveSheetName;
      await approveReview(selectedItem.request_id, {
        new_location: newLocation,
        new_turtle_id: turtleIdForReview,
        uploaded_image_path: selectedItem.uploaded_image,
        sheets_data: effectiveSheetsData
          ? {
              ...effectiveSheetsData,
              sheet_name: effectiveSheetName,
              primary_id: sheetsDataCreated ? (finalPrimaryId ?? undefined) : undefined,
            }
          : undefined,
        photo_type: selectedItem.photo_type ?? 'plastron',
      });
      notifications.show({
        title: 'Success!',
        message: 'New turtle created successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
      });
      setShowNewTurtleModal(false);
      setQueueItems((prev) =>
        prev.filter((i) => i.request_id !== selectedItem.request_id),
      );
      setSelectedItem(null);
      setSelectedCandidate(null);
      setSheetsData(null);
      setPrimaryId(null);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create new turtle',
        color: 'red',
      });
      throw error;
    } finally {
      setProcessing(null);
    }
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
        const primaryIdResponse = await generatePrimaryId({ state, location });
        if (primaryIdResponse.success && primaryIdResponse.primary_id) {
          primaryIdVal = primaryIdResponse.primary_id;
          setNewTurtlePrimaryId(primaryIdVal);
        }
      } catch (error) {
        console.error('Error generating primary ID:', error);
      }
    }
    await handleConfirmNewTurtle(sheetName, data);
  };

  const handleOpenDeleteModal = (item: ReviewQueueItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setItemToDelete(item);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;
    setDeleting(true);
    try {
      await deleteReviewItem(itemToDelete.request_id);
      notifications.show({
        title: 'Deleted',
        message: 'Upload removed from review queue',
        color: 'green',
      });
      setQueueItems((prev) =>
        prev.filter((i) => i.request_id !== itemToDelete.request_id),
      );
      if (selectedItem?.request_id === itemToDelete.request_id) {
        setSelectedItem(null);
        setSelectedCandidate(null);
        setSheetsData(null);
        setPrimaryId(null);
      }
      setDeleteModalOpen(false);
      setItemToDelete(null);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to delete',
        color: 'red',
      });
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteModal = () => {
    if (!deleting) {
      setDeleteModalOpen(false);
      setItemToDelete(null);
    }
  };

  const clearSelectedItem = () => {
    setSelectedItem(null);
    setSelectedCandidate(null);
    setSheetsData(null);
    setPrimaryId(null);
  };

  /** Delete a queue item directly (no modal). Removes from local state and clears selection. */
  const deleteQueueItemDirect = async (requestId: string) => {
    await deleteReviewItem(requestId);
    setQueueItems((prev) => prev.filter((i) => i.request_id !== requestId));
    if (selectedItem?.request_id === requestId) {
      clearSelectedItem();
    }
  };

  const setSelectedSheetFilterAndLoad = (value: string) => {
    setSelectedSheetFilter(value);
    loadAllTurtles(value || undefined);
  };

  const filteredTurtles = allTurtles.filter((turtle) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      turtle.id?.toLowerCase().includes(query) ||
      turtle.primary_id?.toLowerCase().includes(query) ||
      turtle.name?.toLowerCase().includes(query) ||
      turtle.species?.toLowerCase().includes(query) ||
      turtle.location?.toLowerCase().includes(query) ||
      turtle.general_location?.toLowerCase().includes(query)
    );
  });

  return {
    activeTab,
    setActiveTab,
    queueItems,
    queueLoading,
    selectedItem,
    selectedCandidate,
    processing,
    sheetsData,
    primaryId,
    loadingTurtleData,
    candidateNames,
    candidateOriginalIds,
    loadingCandidateNames,
    deleteModalOpen,
    setDeleteModalOpen,
    itemToDelete,
    setItemToDelete,
    deleting,
    sheetsFormRef,
    showNewTurtleModal,
    setShowNewTurtleModal,
    newTurtlePrimaryId,
    newTurtleSheetsData,
    newTurtleSheetName,
    allTurtles,
    turtlesLoading,
    selectedTurtle,
    setSelectedTurtle,
    searchQuery,
    setSearchQuery,
    selectedSheetFilter,
    availableSheets,
    sheetsListLoading,
    filteredTurtles,
    loadAllTurtles,
    handleItemSelect,
    handleSaveSheetsData,
    handleSaveTurtleFromBrowser,
    handleSaveAndApprove,
    handleCombinedButtonClick,
    handleCreateNewTurtle,
    handleConfirmNewTurtle,
    handleSaveNewTurtleSheetsData,
    handleOpenDeleteModal,
    handleConfirmDelete,
    closeDeleteModal,
    clearSelectedItem,
    setSelectedSheetFilterAndLoad,
    refreshQueueItem,
    deleteQueueItemDirect,
  };
}
