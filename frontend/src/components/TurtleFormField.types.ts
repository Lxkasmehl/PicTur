/**
 * Types for TurtleFormField component
 */

import type { TurtleSheetsData } from '../services/api';

export type TurtleFormFieldType = 'text' | 'select' | 'textarea';

export interface TurtleFormFieldProps {
  field: keyof TurtleSheetsData;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  /** Optional help content shown in a "?" tooltip next to the label. */
  infoTooltip?: string;
  type?: TurtleFormFieldType;
  selectData?: string[] | { value: string; label: string }[];
  isFieldModeRestricted: boolean;
  isFieldUnlocked: (field: keyof TurtleSheetsData) => boolean;
  requestUnlock: (field: keyof TurtleSheetsData) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
}
