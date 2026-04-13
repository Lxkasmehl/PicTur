/**
 * Hook for TurtleSheetsDataForm: state, effects, and submit/create-sheet logic
 */

import React, { useState, useEffect } from 'react';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import type { TurtleSheetsData, GeneralLocationCatalog } from '../services/api';
import {
  listSheets,
  listCommunitySheets,
  getLocations,
  createSheet,
  getTurtleNames,
  generateTurtleId,
  getGeneralLocationCatalog,
  addGeneralLocation,
} from '../services/api';
import type {
  TurtleSheetsDataFormProps,
  UseTurtleSheetsDataFormReturn,
} from '../components/TurtleSheetsDataForm.types';
import { normalizeTurtleSheetsDateFieldsToUs } from '../utils/usDateFormat';

export type { UseTurtleSheetsDataFormReturn } from '../components/TurtleSheetsDataForm.types';

/** Backend folder names that are not selectable as turtle location (new-turtle dialog). */
const LOCATION_SYSTEM_FOLDERS = ['Community_Uploads', 'Review_Queue', 'Incidental_Finds', 'Incidental Places', 'benchmarks'];

const normalizeValue = (value: string) => (value || '').trim().replace(/\s+/g, ' ');

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
    matchPageColumnLayout = false,
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
  const [generalLocationCatalog, setGeneralLocationCatalog] = useState<GeneralLocationCatalog | null>(null);
  const [loadingGeneralLocations, setLoadingGeneralLocations] = useState(false);
  const [showCreateGeneralLocationModal, setShowCreateGeneralLocationModal] = useState(false);
  const [newGeneralLocationName, setNewGeneralLocationName] = useState('');
  const [creatingGeneralLocation, setCreatingGeneralLocation] = useState(false);
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

  /** Admin / backend-path flows use the general-locations catalog (dropdown); pure community sheet does not. */
  const generalLocationUseCatalog =
    sheetSource === 'admin' || useBackendLocations || requireNewSheetForCommunityMatch;

  /**
   * Match layout: same read-only / unlock rules in create and edit (subset columns on Turtle Match).
   * Legacy add-only (no match layout): only when editing.
   */
  const isFieldModeRestricted =
    Boolean(matchPageColumnLayout) || (addOnlyMode && mode === 'edit');
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
      setFormData(normalizeTurtleSheetsDateFieldsToUs(initialData));
      setAdditionalNotes('');
      setAdditionalDatesRefound('');
      setUnlockedFields(new Set());
    }
    if (initialSheetName) {
      setSelectedSheetName(initialSheetName);
    }
  }, [initialData, initialSheetName]);

  useEffect(() => {
    let cancelled = false;
    setLoadingGeneralLocations(true);
    getGeneralLocationCatalog()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.catalog) {
          setGeneralLocationCatalog(res.catalog);
        } else {
          setGeneralLocationCatalog({ states: {}, sheet_defaults: {} });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeneralLocationCatalog({ states: {}, sheet_defaults: {} });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingGeneralLocations(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const selectedSheetDefaultGeneralLocation = React.useMemo(() => {
    const sheet = normalizeValue(selectedSheetName);
    if (!sheet || !generalLocationCatalog) return '';
    return normalizeValue(generalLocationCatalog.sheet_defaults[sheet]?.general_location || '');
  }, [generalLocationCatalog, selectedSheetName]);

  const selectedPathGeneralLocation = React.useMemo(() => {
    if (!useBackendLocations || !selectedSheetName.includes('/')) return '';
    const parts = selectedSheetName.split('/').map((p) => normalizeValue(p)).filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join('/') : '';
  }, [selectedSheetName, useBackendLocations]);

  const selectedGeneralLocationState = React.useMemo(() => {
    const sheet = normalizeValue(selectedSheetName);
    if (!sheet) return '';
    if (generalLocationCatalog?.sheet_defaults[sheet]?.state) {
      return normalizeValue(generalLocationCatalog.sheet_defaults[sheet].state);
    }
    if (selectedPathGeneralLocation && sheet.includes('/')) {
      return normalizeValue(sheet.split('/')[0] || '');
    }
    if (sheet.includes('/')) {
      return normalizeValue(sheet.split('/')[0] || '');
    }
    return sheet;
  }, [generalLocationCatalog, selectedPathGeneralLocation, selectedSheetName]);

  const selectedGeneralLocationDefault = selectedSheetDefaultGeneralLocation || selectedPathGeneralLocation;
  const selectedGeneralLocationLocked = Boolean(selectedSheetDefaultGeneralLocation);

  const generalLocationOptions = React.useMemo(() => {
    const options = new Map<string, string>();
    const currentValue = normalizeValue(formData.general_location || '');
    const fixedValue = normalizeValue(selectedGeneralLocationDefault || '');
    const stateOptions = selectedGeneralLocationState
      ? generalLocationCatalog?.states[selectedGeneralLocationState] || []
      : [];
    for (const option of stateOptions) {
      const normalized = normalizeValue(option);
      if (normalized) options.set(normalized.toLowerCase(), normalized);
    }
    if (fixedValue) {
      options.set(fixedValue.toLowerCase(), fixedValue);
    }
    if (currentValue) {
      options.set(currentValue.toLowerCase(), currentValue);
    }
    return Array.from(options.values()).map((value) => ({ value, label: value }));
  }, [
    formData.general_location,
    generalLocationCatalog,
    selectedGeneralLocationDefault,
    selectedGeneralLocationState,
  ]);

  useEffect(() => {
    if (!selectedSheetName) return;
    const resolved = normalizeValue(selectedGeneralLocationDefault || '');
    if (resolved) {
      setFormData((prev) => {
        const prevNormalized = normalizeValue(prev.general_location || '');
        if (prevNormalized === resolved) return prev;
        return { ...prev, general_location: resolved };
      });
      setErrors((prev) => {
        if (!prev.general_location) return prev;
        const next = { ...prev };
        delete next.general_location;
        return next;
      });
      return;
    }

    if (selectedPathGeneralLocation) {
      setFormData((prev) => {
        const prevNormalized = normalizeValue(prev.general_location || '');
        const pathNormalized = normalizeValue(selectedPathGeneralLocation);
        if (prevNormalized === pathNormalized) return prev;
        return { ...prev, general_location: selectedPathGeneralLocation };
      });
    }
  }, [selectedGeneralLocationDefault, selectedPathGeneralLocation, selectedSheetName]);

  useEffect(() => {
    if (!generalLocationUseCatalog) return;
    if (!selectedGeneralLocationState || !generalLocationCatalog || selectedGeneralLocationLocked) return;
    const current = normalizeValue(formData.general_location || '');
    if (!current) return;
    const validLocations = generalLocationCatalog.states[selectedGeneralLocationState] || [];
    const isValid = validLocations.some((location) => normalizeValue(location).toLowerCase() === current.toLowerCase());
    const matchesPath = normalizeValue(selectedPathGeneralLocation || '').toLowerCase() === current.toLowerCase();
    if (isValid || matchesPath) return;
    setFormData((prev) => ({ ...prev, general_location: '' }));
  }, [
    formData.general_location,
    generalLocationCatalog,
    generalLocationUseCatalog,
    selectedGeneralLocationLocked,
    selectedGeneralLocationState,
    selectedPathGeneralLocation,
    selectedSheetName,
  ]);

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

  const clearGeneralLocationFieldError = () => {
    setErrors((prev) => {
      if (!prev.general_location) return prev;
      const next = { ...prev };
      delete next.general_location;
      return next;
    });
  };

  /** User changed Sheet/Location: reset general_location so a value from the previous tab (e.g. Hawkeye) is not left visible; catalog effect then applies fixed defaults if any. */
  const applySelectedSheetChange = (value: string) => {
    setSelectedSheetName(value);
    const parts = value
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);

    if (useBackendLocations) {
      if (parts.length > 1) {
        const loc = parts.slice(1).join('/');
        setFormData((prev) => ({ ...prev, general_location: loc }));
        clearGeneralLocationFieldError();
        return;
      }
      setFormData((prev) => ({ ...prev, general_location: '' }));
      clearGeneralLocationFieldError();
      return;
    }

    setFormData((prev) => ({ ...prev, general_location: '' }));
    clearGeneralLocationFieldError();
  };

  const handleSelectedSheetNameChange = (value: string) => {
    applySelectedSheetChange(value);
  };

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
        applySelectedSheetChange(sheetName.trim());
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

  const handleCreateGeneralLocation = async (generalLocation: string) => {
    const state = normalizeValue(selectedGeneralLocationState);
    const value = normalizeValue(generalLocation);
    if (!state) {
      notifications.show({
        title: 'Error',
        message: 'Please select a sheet or state before adding a General Location',
        color: 'red',
      });
      return;
    }
    if (!value) {
      notifications.show({
        title: 'Error',
        message: 'Please enter a General Location name',
        color: 'red',
      });
      return;
    }

    setCreatingGeneralLocation(true);
    try {
      const response = await addGeneralLocation({
        state,
        general_location: value,
      });
      if (!response.success || !response.catalog) {
        throw new Error(response.error || 'Failed to add general location');
      }
      setGeneralLocationCatalog(response.catalog);
      setFormData((prev) => ({ ...prev, general_location: value }));
      setErrors((prev) => {
        if (!prev.general_location) return prev;
        const next = { ...prev };
        delete next.general_location;
        return next;
      });
      setShowCreateGeneralLocationModal(false);
      setNewGeneralLocationName('');
      let syncMessage = '';
      if (response.synced && response.sheets_updated !== undefined) {
        syncMessage = ` and ${response.sheets_updated} Google Sheet${response.sheets_updated === 1 ? '' : 's'} updated`;
      } else if (response.sync_error) {
        syncMessage = ` (Google Sheets sync failed: ${response.sync_error})`;
      } else if (!response.synced) {
        syncMessage = ' (Google Sheets sync skipped)';
      }
      notifications.show({
        title: 'Success',
        message: `General Location "${value}" added for ${state}${syncMessage}`,
        color: 'green',
      });
      if (response.sync_warning) {
        notifications.show({
          title: 'Google Sheets',
          message: response.sync_warning,
          color: 'yellow',
        });
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to add general location',
        color: 'red',
      });
    } finally {
      setCreatingGeneralLocation(false);
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
    const resolvedGeneralLocation =
      normalizeValue(selectedGeneralLocationDefault || formData.general_location || '');
    // Admin backend path is data/State/Location/PrimaryID; Location comes from General Location
    // unless a location-level selector option was chosen (e.g. Kansas/North Topeka).
    if (
      (useBackendLocations || sheetSource === 'admin') &&
      (mode === 'create' || requireNewSheetForCommunityMatch) &&
      !selectedHasLocation &&
      !resolvedGeneralLocation
    ) {
      newErrors.general_location = 'General location is required (used for backend path State/Location)';
    }
    if (
      (sheetSource === 'admin' || useBackendLocations) &&
      selectedGeneralLocationState &&
      !selectedGeneralLocationLocked &&
      resolvedGeneralLocation &&
      generalLocationCatalog
    ) {
      const validLocations = generalLocationCatalog.states[selectedGeneralLocationState] || [];
      const isValid = validLocations.some(
        (location) => normalizeValue(location).toLowerCase() === resolvedGeneralLocation.toLowerCase(),
      );
      const matchesPath =
        normalizeValue(selectedPathGeneralLocation || '').toLowerCase() === resolvedGeneralLocation.toLowerCase();
      if (!isValid && !matchesPath) {
        newErrors.general_location = `General location must be one of the configured options for ${selectedGeneralLocationState}`;
      }
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
      if (isFieldModeRestricted && !matchPageColumnLayout) {
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
      const resolvedGeneralLocation =
        normalizeValue(selectedGeneralLocationDefault || dataToSave.general_location || '');

      // If a location-level option was chosen in selector (e.g. Kansas/North Topeka),
      // keep sheets tab as state (Kansas) and mirror location into general_location.
      if (useBackendLocations && selectedLocationFromPath) {
        dataToSave = { ...dataToSave, general_location: selectedLocationFromPath };
      } else if (resolvedGeneralLocation) {
        dataToSave = { ...dataToSave, general_location: resolvedGeneralLocation };
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

      dataToSave = normalizeTurtleSheetsDateFieldsToUs(dataToSave);

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

  return {
    formData,
    loading,
    errors,
    availableSheets,
    selectedSheetName,
    setSelectedSheetName: handleSelectedSheetNameChange,
    generalLocationCatalog,
    selectedGeneralLocationState,
    selectedGeneralLocationDefault,
    generalLocationOptions,
    generalLocationUseCatalog,
    generalLocationLoading: loadingGeneralLocations,
    generalLocationLocked: selectedGeneralLocationLocked,
    loadingSheets,
    showCreateSheetModal,
    setShowCreateSheetModal,
    newSheetName,
    setNewSheetName,
    creatingSheet,
    showCreateGeneralLocationModal,
    setShowCreateGeneralLocationModal,
    newGeneralLocationName,
    setNewGeneralLocationName,
    creatingGeneralLocation,
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
    handleCreateGeneralLocation,
    handleSubmit,
    loadingTurtleNames,
  };
}
