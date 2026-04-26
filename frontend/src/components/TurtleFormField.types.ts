/**
 * Types for TurtleFormField component
 */

import type { TurtleSheetsData } from '../services/api';
import type { ReactNode } from 'react';

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
  /** Match page (and similar): show value disabled with no unlock control. */
  readOnlyDisplay?: boolean;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  searchable?: boolean;
  afterInput?: ReactNode;
  /** When set, used as React `key` on Select/NativeSelect so the control remounts (fixes stale Mantine display with keepMounted). */
  selectRemountKey?: string;
}
