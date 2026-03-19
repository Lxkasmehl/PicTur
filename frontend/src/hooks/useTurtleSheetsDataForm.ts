/**
 * Hook for TurtleSheetsDataForm: state, effects, and submit/create-sheet logic
 */

import React, { useState, useEffect } from 'react';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import type { TurtleSheetsData } from '../services/api';
import {
  listSheets,
  listCommunitySheets,
  getLocations,
  createSheet,
  getTurtleNames,
  generateTurtleId,
} from '../services/api';
import type {
  TurtleSheetsDataFormProps,
  UseTurtleSheetsDataFormReturn,
} from '../components/TurtleSheetsDataForm.types';

export type { UseTurtleSheetsDataFormReturn } from '../components/TurtleSheetsDataForm.types';

/** Backend folder names that are not selectable as turtle location (new-turtle dialog). */
const LOCATION_SYSTEM_FOLDERS = ['Community_Uploads', 'Review_Queue', 'Incidental_Finds', 'Incidental Places', 'benchmarks'];

export function useTurtleSheetsDataForm(
  props: TurtleSheetsDataFormProps,
): UseTurtleSheetsDataFormReturn {
  const {
    initialData,
    sheetName: initialSheetName,
    onSave,
    mode,
    onCombinedSubmit,
    addOnlyMode = false,
    initialAvailableSheets,
    useBackendLocations = false,
    sheetSource = 'admin',
    requireNewSheetForCommunityMatch = false,
  } = props;

  const [formData, setFormData] = useState<TurtleSheetsData>(initialData || {});
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableSheets, setAvailableSheets] = useState<string[]>(
    initialAvailableSheets ?? [],
  );
  const [selectedSheetName, setSelectedSheetName] = useState<string>(
    initialSheetName || '',
  );
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [showCreateSheetModal, setShowCreateSheetModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [unlockedFields, setUnlockedFields] = useState<Set<keyof TurtleSheetsData>>(
    new Set(),
  );
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [additionalDatesRefound, setAdditionalDatesRefound] = useState('');
  const [unlockConfirmField, setUnlockConfirmField] = useState<
    keyof TurtleSheetsData | null
  >(null);
  const [existingTurtleNames, setExistingTurtleNames] = useState<
    { name: string; primary_id: string }[] | null
  >(null);

  const duplicateNameMessage = 'This name is already used by another turtle';

  const isFieldModeRestricted = addOnlyMode && mode === 'edit';
  const isFieldUnlocked = (field: keyof TurtleSheetsData) => unlockedFields.has(field);
  const requestUnlock = (field: keyof TurtleSheetsData) => setUnlockConfirmField(field);
  const confirmUnlock = () => {
    if (unlockConfirmField) {
      setUnlockedFields((prev) => new Set(prev).add(unlockConfirmField));
      setUnlockConfirmField(null);
    }
  };

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
      setAdditionalNotes('');
      setAdditionalDatesRefound('');
      setUnlockedFields(new Set());
    }
    if (initialSheetName) {
      setSelectedSheetName(initialSheetName);
    }
  }, [initialData, initialSheetName]);

  // In create mode, fetch turtle names for duplicate-name validation (across all sheets)
  useEffect(() => {
    if (mode !== 'create') return;
    let cancelled = false;
    getTurtleNames()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.names) setExistingTurtleNames(res.names);
        else setExistingTurtleNames([]);
      })
      .catch(() => {
        if (!cancelled) setExistingTurtleNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // When turtle names finish loading in create mode, re-validate name field (user may have typed before load)
  useEffect(() => {
    if (mode !== 'create' || existingTurtleNames === null) return;
    if (!formData.name?.trim()) return;
    const isDuplicate = existingTurtleNames.some(
      (n) => n.name.trim().toLowerCase() === formData.name!.trim().toLowerCase(),
    );
    if (isDuplicate) {
      setErrors((prev) => ({ ...prev, name: duplicateNameMessage }));
    }
  }, [mode, existingTurtleNames, formData.name, duplicateNameMessage]);

  // In create mode, when sheet and sex are set, generate biology ID and set id field.
  // Use a request ref so we only apply the latest response (avoids stale updates with Strict Mode or rapid re-runs).
  const generateIdRequestRef = React.useRef(0);
  useEffect(() => {
    if (mode !== 'create' || !selectedSheetName) return;
    const sex = (formData.sex || '').trim().toUpperCase();
    if (!sex) return;
    const sheetNameForApi =
      useBackendLocations && selectedSheetName.includes('/')
        ? selectedSheetName.split('/')[0].trim()
        : selectedSheetName;
    if (!sheetNameForApi) return;
    const requestId = ++generateIdRequestRef.current;
    const targetSpreadsheet = sheetSource === 'community' ? 'community' : 'research';
    generateTurtleId({ sheet_name: sheetNameForApi, sex, target_spreadsheet: targetSpreadsheet })
      .then((res) => {
        if (requestId !== generateIdRequestRef.current) return;
        if (res.success && res.id) {
          setFormData((prev) => ({ ...prev, id: res.id! }));
        }
      })
      .catch(() => {});
  }, [mode, selectedSheetName, formData.sex, useBackendLocations, sheetSource]);

  useEffect(() => {
    // When admin source and parent passed a list, use it to avoid duplicate fetch
    if (sheetSource === 'admin' && initialAvailableSheets != null && initialAvailableSheets.length > 0) {
      setAvailableSheets(initialAvailableSheets);
      setLoadingSheets(false);
      if (!requireNewSheetForCommunityMatch) {
        setSelectedSheetName((current) => {
          if (!current && !initialSheetName && initialAvailableSheets.length > 0) return initialAvailableSheets[0];
          return current;
        });
      }
      return;
    }

    let cancelled = false;

    const loadOptions = async () => {
      setLoadingSheets(true);
      try {
        if (sheetSource === 'community') {
          const response = await listCommunitySheets();
          if (cancelled) return;
          if (response.success && response.sheets) {
            const sheets = response.sheets;
            setAvailableSheets(sheets);
            setSelectedSheetName((current) => {
              if (!current && !initialSheetName && sheets.length > 0) return sheets[0];
              return current;
            });
          } else {
            setAvailableSheets([]);
          }
          return;
        }
        if (useBackendLocations) {
          const response = await getLocations();
          if (cancelled) return;
          if (response.success && response.locations) {
            const filtered = response.locations.filter((path) => {
              const first = path.split('/')[0]?.trim() || '';
              return first && !LOCATION_SYSTEM_FOLDERS.includes(first);
            });
            // Only top-level states in dropdown; subfolders (e.g. Kansas/Wichita) are chosen via General Location field.
            const stateSet = new Set<string>();
            for (const path of filtered) {
              const first = path.split('/')[0]?.trim();
              if (first) stateSet.add(first);
            }
            const options = Array.from(stateSet).sort((a, b) =>
              a.localeCompare(b, undefined, { sensitivity: 'base' }),
            );
            setAvailableSheets(options);
            setSelectedSheetName((current) => {
              if (!current && !initialSheetName && options.length > 0) {
                return options[0];
              }
              return current;
            });
          } else {
            setAvailableSheets([]);
          }
        } else {
          const response = await listSheets();
          if (cancelled) return;
          if (response.success && response.sheets) {
            const sheets = response.sheets;
            setAvailableSheets(sheets);
            setSelectedSheetName((current) => {
              if (!current && !initialSheetName && sheets.length > 0) {
                return sheets[0];
              }
              return current;
            });
          } else {
            setAvailableSheets([]);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            sheetSource === 'community'
              ? 'Failed to load community sheets:'
              : useBackendLocations
                ? 'Failed to load locations:'
                : 'Failed to load sheets:',
            error,
          );
          setAvailableSheets([]);
        }
      } finally {
        if (!cancelled) setLoadingSheets(false);
      }
    };

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [initialSheetName, initialAvailableSheets, useBackendLocations, sheetSource, requireNewSheetForCommunityMatch]);

  const handleCreateNewSheet = async (sheetName: string) => {
    if (!sheetName?.trim()) {
      notifications.show({
        title: 'Error',
        message: 'Please enter a sheet name',
        color: 'red',
      });
      return;
    }

    setCreatingSheet(true);
    try {
      const targetSpreadsheet = sheetSource === 'community' ? 'community' : 'research';
      const response = await createSheet({
        sheet_name: sheetName.trim(),
        target_spreadsheet: targetSpreadsheet,
      });
      if (response.success) {
        if (sheetSource === 'community') {
          const sheetsResponse = await listCommunitySheets();
          if (sheetsResponse.success && sheetsResponse.sheets) {
            setAvailableSheets(sheetsResponse.sheets);
          }
        } else {
          const sheetsResponse = await listSheets();
          if (sheetsResponse.success && sheetsResponse.sheets) {
            setAvailableSheets(sheetsResponse.sheets);
          }
        }
        setSelectedSheetName(sheetName.trim());
        setShowCreateSheetModal(false);
        setNewSheetName('');
        notifications.show({
          title: 'Success',
          message: `Sheet "${sheetName}" created successfully`,
          color: 'green',
        });
      } else {
        throw new Error(response.error || 'Failed to create sheet');
      }
    } catch (error) {
      console.error('Error creating sheet:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create sheet',
        color: 'red',
      });
    } finally {
      setCreatingSheet(false);
    }
  };

  const checkDuplicateName = (name: string): boolean => {
    if (!existingTurtleNames || !name.trim()) return false;
    const lower = name.trim().toLowerCase();
    return existingTurtleNames.some((n) => n.name.trim().toLowerCase() === lower);
  };

  const handleChange = (field: keyof TurtleSheetsData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    if (mode === 'create' && field === 'name') {
      setErrors((prev) => {
        const isDuplicate = checkDuplicateName(value);
        if (isDuplicate) return { ...prev, name: duplicateNameMessage };
        const { name: _, ...rest } = prev;
        return rest;
      });
    }
    // In create mode, when user selects sex, fetch biology ID using selected sheet or first available
    // so the ID field updates even if the effect hasn't run yet (e.g. timing/Strict Mode / webkit).
    if (mode === 'create' && field === 'sex' && value?.trim()) {
      const sheetToUse = selectedSheetName || availableSheets[0];
      if (sheetToUse) {
        const sheetNameForApi =
          useBackendLocations && sheetToUse.includes('/')
            ? sheetToUse.split('/')[0].trim()
            : sheetToUse;
        if (sheetNameForApi) {
          const requestId = ++generateIdRequestRef.current;
          const targetSpreadsheet = sheetSource === 'community' ? 'community' : 'research';
          generateTurtleId({
            sheet_name: sheetNameForApi,
            sex: value.trim(),
            target_spreadsheet: targetSpreadsheet,
          })
            .then((res) => {
              if (requestId !== generateIdRequestRef.current) return;
              if (res.success && res.id) {
                setFormData((prev) => ({ ...prev, id: res.id! }));
              }
            })
            .catch(() => {});
        }
      }
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (mode === 'create' && existingTurtleNames === null) {
      newErrors.name =
        'Loading existing names to check for duplicates. Please wait a moment.';
    } else if (mode === 'create' && formData.name && checkDuplicateName(formData.name)) {
      newErrors.name = duplicateNameMessage;
    }
    const selectedHasLocation = useBackendLocations && selectedSheetName.includes('/');
    // Admin backend path is data/State/Location/PrimaryID; Location comes from General Location
    // unless a location-level selector option was chosen (e.g. Kansas/North Topeka).
    if (
      (useBackendLocations || sheetSource === 'admin') &&
      (mode === 'create' || requireNewSheetForCommunityMatch) &&
      !selectedHasLocation &&
      !formData.general_location?.trim()
    ) {
      newErrors.general_location = 'General location is required (used for backend path State/Location)';
    }
    if (requireNewSheetForCommunityMatch && !selectedSheetName?.trim()) {
      newErrors.sheet_name = 'Select an admin sheet where this turtle will be stored (moving from community to research).';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const loadingTurtleNames = mode === 'create' && existingTurtleNames === null;

  const handleSubmit = async () => {
    if (!selectedSheetName) {
      notifications.show({
        title: 'Validation Error',
        message: 'Please select a sheet',
        color: 'red',
        icon: React.createElement(IconX, { size: 18 }),
      });
      return;
    }

    if (!validate()) {
      notifications.show({
        title: 'Validation Error',
        message: 'Please fix the errors in the form',
        color: 'red',
        icon: React.createElement(IconX, { size: 18 }),
      });
      return;
    }

    setLoading(true);
    try {
      let dataToSave = formData;
      if (isFieldModeRestricted) {
        const mergedNotes = [formData.notes, additionalNotes]
          .filter(Boolean)
          .join('\n\n');
        const existingDates = (formData.dates_refound || '')
          .split(/[\s,]+/)
          .filter(Boolean);
        const newDates = additionalDatesRefound.split(/[\s,]+/).filter(Boolean);
        const mergedDatesRefound = [...existingDates, ...newDates].join(', ');
        dataToSave = {
          ...formData,
          ...(mergedNotes !== (formData.notes || '') ? { notes: mergedNotes } : {}),
          ...(mergedDatesRefound !== (formData.dates_refound || '')
            ? { dates_refound: mergedDatesRefound }
            : {}),
        };
      }
      const selectedPathParts = selectedSheetName
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      const selectedState = selectedPathParts[0] || selectedSheetName;
      const selectedLocationFromPath =
        selectedPathParts.length > 1 ? selectedPathParts.slice(1).join('/') : '';

      // If a location-level option was chosen in selector (e.g. Kansas/North Topeka),
      // keep sheets tab as state (Kansas) and mirror location into general_location.
      if (useBackendLocations && selectedLocationFromPath && !dataToSave.general_location?.trim()) {
        dataToSave = { ...dataToSave, general_location: selectedLocationFromPath };
      }

      // Backend path: data/State/Location/PrimaryID where Location = general_location.
      const backendLocationPath =
        useBackendLocations && selectedPathParts.length > 1
          ? selectedSheetName
          : useBackendLocations && selectedState && dataToSave.general_location?.trim()
            ? `${selectedState}/${dataToSave.general_location.trim()}`
            : useBackendLocations && selectedState
              ? selectedState
            : undefined;

      const sheetNameForSubmit =
        useBackendLocations && selectedPathParts.length > 1
          ? selectedState
          : selectedSheetName;

      if (onCombinedSubmit) {
        await onCombinedSubmit(dataToSave, sheetNameForSubmit, backendLocationPath);
      } else {
        await onSave(dataToSave, sheetNameForSubmit, backendLocationPath);
        notifications.show({
          title: 'Success!',
          message: `Turtle data ${mode === 'create' ? 'created' : 'updated'} successfully`,
          color: 'green',
          icon: React.createElement(IconCheck, { size: 18 }),
        });
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to save turtle data',
        color: 'red',
        icon: React.createElement(IconX, { size: 18 }),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectedSheetNameChange = (value: string) => {
    setSelectedSheetName(value);
    if (!useBackendLocations) return;
    const parts = value
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      const loc = parts.slice(1).join('/');
      setFormData((prev) => ({ ...prev, general_location: prev.general_location?.trim() ? prev.general_location : loc }));
      setErrors((prev) => {
        if (!prev.general_location) return prev;
        const next = { ...prev };
        delete next.general_location;
        return next;
      });
    }
  };

  return {
    formData,
    loading,
    errors,
    availableSheets,
    selectedSheetName,
    setSelectedSheetName: handleSelectedSheetNameChange,
    loadingSheets,
    showCreateSheetModal,
    setShowCreateSheetModal,
    newSheetName,
    setNewSheetName,
    creatingSheet,
    additionalNotes,
    setAdditionalNotes,
    additionalDatesRefound,
    setAdditionalDatesRefound,
    unlockConfirmField,
    setUnlockConfirmField,
    isFieldModeRestricted,
    isFieldUnlocked,
    requestUnlock,
    confirmUnlock,
    handleChange,
    handleCreateNewSheet,
    handleSubmit,
    loadingTurtleNames,
  };
}
