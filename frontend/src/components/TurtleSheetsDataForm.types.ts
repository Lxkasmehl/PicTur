/**
 * Types for TurtleSheetsDataForm and related components
 */

import type { TurtleSheetsData } from '../services/api';
import type { GeneralLocationCatalog } from '../services/api';

export interface TurtleSheetsDataFormProps {
  initialData?: TurtleSheetsData;
  sheetName?: string;
  state?: string;
  location?: string;
  hintLocationFromCommunity?: string;
  hintCoordinates?: { latitude: number; longitude: number; source?: 'gps' | 'manual' };
  primaryId?: string;
  onSave: (data: TurtleSheetsData, sheetName: string, backendLocationPath?: string) => Promise<void>;
  onCancel?: () => void;
  mode: 'create' | 'edit';
  hideSubmitButton?: boolean;
  onCombinedSubmit?: (data: TurtleSheetsData, sheetName: string, backendLocationPath?: string) => Promise<void>;
  addOnlyMode?: boolean;
  initialAvailableSheets?: string[];
  /** When true, use backend locations (State/Location) instead of Google Sheet tabs. For community upload new turtle: sheet = State, path = State/Location. */
  useBackendLocations?: boolean;
  /**
   * Which spreadsheet drives the sheet/location dropdown.
   * - 'admin': admin-facing sheet (root data/ folders) – e.g. Turtle Match, admin uploads in Review Queue.
   * - 'community': community-facing sheet (Community_Uploads subfolders) – e.g. community uploads in Review Queue.
   */
  sheetSource?: 'admin' | 'community';
  /**
   * When true, the matched turtle is from the community spreadsheet (admin re-found it).
   * Sheet selection is required (admin sheet where the turtle will be stored) and the sheet field is not locked.
   */
  requireNewSheetForCommunityMatch?: boolean;
  /**
   * Turtle Match: only a subset of columns is shown; some are read-only and some unlock for edit.
   * Turtle Records / Sheets Browser: omit or false for full sheet columns.
   */
  matchPageColumnLayout?: boolean;
}

export interface TurtleSheetsDataFormRef {
  submit: () => Promise<void>;
}

/** Props for TurtleSheetsDataFormFields (form grid fragment) */
export interface TurtleSheetsDataFormFieldsProps {
  formData: TurtleSheetsData;
  handleChange: (field: keyof TurtleSheetsData, value: string) => void;
  isFieldModeRestricted: boolean;
  isFieldUnlocked: (field: keyof TurtleSheetsData) => boolean;
  requestUnlock: (field: keyof TurtleSheetsData) => void;
  additionalDatesRefound: string;
  setAdditionalDatesRefound: (v: string) => void;
  additionalNotes: string;
  setAdditionalNotes: (v: string) => void;
  primaryId?: string;
  hintLocationFromCommunity?: string;
  hintCoordinates?: { latitude: number; longitude: number; source?: 'gps' | 'manual' };
  /** Field-level validation errors keyed by field name */
  errors?: Record<string, string>;
  /** In create mode the ID field is always disabled and filled by generate-id (sex + sequence per sheet). */
  mode?: 'create' | 'edit';
  /** When true, General Location is required (used for backend path State/Location). */
  requireGeneralLocationForPath?: boolean;
  /** When true, sheet and general_location are always editable (no unlock); used on Match page for community→admin. */
  requireNewSheetForCommunityMatch?: boolean;
  /** When false, General Location is a plain text field (community spreadsheet; no backend State/Location path). */
  generalLocationUseCatalog: boolean;
  generalLocationOptions?: { value: string; label: string }[];
  generalLocationLoading?: boolean;
  generalLocationLocked?: boolean;
  generalLocationStateLabel?: string;
  onCreateGeneralLocation?: () => void;
  /** Remount General Location select when sheet changes (Mantine Select can show stale label otherwise). */
  generalLocationSelectRemountKey?: string;
  matchPageColumnLayout?: boolean;
}

/** Return type of useTurtleSheetsDataForm hook */
export interface UseTurtleSheetsDataFormReturn {
  formData: TurtleSheetsData;
  loading: boolean;
  errors: Record<string, string>;
  availableSheets: string[];
  selectedSheetName: string;
  setSelectedSheetName: (v: string) => void;
  generalLocationCatalog: GeneralLocationCatalog | null;
  selectedGeneralLocationState: string;
  selectedGeneralLocationDefault: string;
  generalLocationOptions: { value: string; label: string }[];
  /** When false, General Location is free text (community sheet); hook and fields stay in sync. */
  generalLocationUseCatalog: boolean;
  generalLocationLoading: boolean;
  generalLocationLocked: boolean;
  loadingSheets: boolean;
  showCreateSheetModal: boolean;
  setShowCreateSheetModal: (v: boolean) => void;
  newSheetName: string;
  setNewSheetName: (v: string) => void;
  creatingSheet: boolean;
  showCreateGeneralLocationModal: boolean;
  setShowCreateGeneralLocationModal: (v: boolean) => void;
  newGeneralLocationName: string;
  setNewGeneralLocationName: (v: string) => void;
  creatingGeneralLocation: boolean;
  additionalNotes: string;
  setAdditionalNotes: (v: string) => void;
  additionalDatesRefound: string;
  setAdditionalDatesRefound: (v: string) => void;
  unlockConfirmField: keyof TurtleSheetsData | null;
  setUnlockConfirmField: (v: keyof TurtleSheetsData | null) => void;
  isFieldModeRestricted: boolean;
  isFieldUnlocked: (field: keyof TurtleSheetsData) => boolean;
  requestUnlock: (field: keyof TurtleSheetsData) => void;
  confirmUnlock: () => void;
  handleChange: (field: keyof TurtleSheetsData, value: string) => void;
  handleCreateNewSheet: (sheetName: string) => Promise<void>;
  handleCreateGeneralLocation: (generalLocation: string) => Promise<void>;
  handleSubmit: () => Promise<void>;
  /** In create mode, true until existing turtle names have been loaded (for duplicate check). */
  loadingTurtleNames: boolean;
}
