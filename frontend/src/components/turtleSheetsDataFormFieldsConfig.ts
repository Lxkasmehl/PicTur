/**
 * Field configuration for TurtleSheetsDataForm (order and layout)
 */

import type { TurtleSheetsData } from '../services/api';

/** Guided indicators for assessing turtle health (shown in Health Status tooltip). */
export const HEALTH_STATUS_INFO_TOOLTIP =
  'When assessing turtle health, consider noting:\n• Mucous discharge from eyes or nose\n• Dull or fragmented iris / eye coloration\n• Burn damage on the shell\n• Structural bone damage (including exposed bone)\n• Missing appendages or tail\n• Signs of dehydration\n• Presence of flesh flies\n• Presence of mites';

/** Sheet “?” columns are often Yes/No plus notes in parentheses or other free text. */
export const FLAG_FIELD_PLACEHOLDER = 'e.g. Yes, No, or free text';

export type FieldSpan = number | { base: number; md: number };

export interface TurtleFormFieldConfig {
  key: keyof TurtleSheetsData;
  label: string;
  placeholder?: string;
  description?: string;
  /** Optional help tooltip shown as a "?" icon next to the label (e.g. guided indicators). */
  infoTooltip?: string;
  type: 'text' | 'select' | 'textarea';
  selectData?: string[];
  span: FieldSpan;
}

export const TURTLE_SHEETS_FORM_FIELDS: TurtleFormFieldConfig[] = [
  { key: 'freq', label: 'Frequency', placeholder: 'Frequency', type: 'text', span: { base: 12, md: 6 } },
  { key: 'id', label: 'ID', placeholder: 'Biology ID', description: 'Biology ID from sheet (read-only when auto-generated)', type: 'text', span: { base: 12, md: 6 } },
  { key: 'pit', label: 'Pit?', placeholder: FLAG_FIELD_PLACEHOLDER, type: 'text', span: { base: 12, md: 6 } },
  {
    key: 'plastron_picture_in_archive',
    label: 'Plastron Picture in Archive?',
    placeholder: FLAG_FIELD_PLACEHOLDER,
    type: 'text',
    span: { base: 12, md: 6 },
  },
  {
    key: 'carapace_picture_in_archive',
    label: 'Carapace Picture in Archive?',
    placeholder: FLAG_FIELD_PLACEHOLDER,
    type: 'text',
    span: { base: 12, md: 6 },
  },
  { key: 'adopted', label: 'Adopted?', placeholder: FLAG_FIELD_PLACEHOLDER, type: 'text', span: { base: 12, md: 6 } },
  { key: 'ibutton', label: 'iButton?', placeholder: FLAG_FIELD_PLACEHOLDER, type: 'text', span: { base: 12, md: 6 } },
  {
    key: 'dna_extracted',
    label: 'Date DNA Extracted?',
    placeholder: 'Date or Yes/No',
    type: 'text',
    span: { base: 12, md: 6 },
  },
  { key: 'date_1st_found', label: 'Date 1st found', placeholder: 'YYYY-MM-DD', type: 'text', span: { base: 12, md: 6 } },
  { key: 'species', label: 'Species', placeholder: 'Species', type: 'text', span: { base: 12, md: 4 } },
  { key: 'name', label: 'Name', placeholder: 'Turtle name', type: 'text', span: { base: 12, md: 4 } },
  { key: 'sex', label: 'Sex', placeholder: 'Select sex', type: 'select', selectData: ['F', 'M', 'J', 'U'], span: { base: 12, md: 4 } },
  { key: 'ibutton_last_set', label: 'iButton Last set', placeholder: 'Date', type: 'text', span: { base: 12, md: 3 } },
  {
    key: 'last_assay_date',
    label: 'Last Assay Date',
    placeholder: 'YYYY-MM-DD',
    description: 'Date last brought in for assays',
    type: 'text',
    span: { base: 12, md: 3 },
  },
  { key: 'dates_refound', label: 'Dates refound', placeholder: 'Comma-separated dates', type: 'text', span: { base: 12, md: 6 } },
  { key: 'specific_location', label: 'Specific Location', placeholder: 'Specific location (sheet column)', type: 'text', span: { base: 12, md: 6 } },
  { key: 'general_location', label: 'General Location', placeholder: 'General location', type: 'text', span: { base: 12, md: 6 } },
  { key: 'location', label: 'Location', placeholder: 'Location', type: 'text', span: { base: 12, md: 6 } },
  {
    key: 'cow_interactions',
    label: 'Cow Interactions?',
    placeholder: FLAG_FIELD_PLACEHOLDER,
    type: 'text',
    span: { base: 12, md: 6 },
  },
  {
    key: 'health_status',
    label: 'Health Status',
    placeholder: 'Describe health observations (e.g. eye/nose discharge, shell damage, dehydration)',
    type: 'textarea',
    infoTooltip: HEALTH_STATUS_INFO_TOOLTIP,
    span: { base: 12, md: 12 },
  },
  { key: 'notes', label: 'Notes', placeholder: 'Additional notes', type: 'textarea', span: { base: 12, md: 12 } },
  { key: 'transmitter_put_on_by', label: 'Transmitter put on by', placeholder: 'Name', type: 'text', span: { base: 12, md: 6 } },
  { key: 'transmitter_on_date', label: 'Transmitter On Date', placeholder: 'Date', type: 'text', span: { base: 12, md: 6 } },
  { key: 'transmitter_type', label: 'Transmitter Type', placeholder: 'Transmitter type', type: 'text', span: { base: 12, md: 6 } },
  { key: 'transmitter_lifespan', label: 'Transmitter lifespan', placeholder: 'Lifespan', type: 'text', span: { base: 12, md: 3 } },
  { key: 'radio_replace_date', label: 'Radio Replace Date', placeholder: 'Date', type: 'text', span: { base: 12, md: 6 } },
  { key: 'old_frequencies', label: 'OLD Frequencies', placeholder: 'Frequencies', type: 'text', span: { base: 12, md: 6 } },
  { key: 'flesh_flies', label: 'Flesh Flies?', placeholder: FLAG_FIELD_PLACEHOLDER, type: 'text', span: { base: 12, md: 6 } },
  { key: 'mass_g', label: 'Mass (g)', placeholder: 'e.g. 250', description: 'Body mass in grams', type: 'text', span: { base: 12, md: 4 } },
  { key: 'curved_carapace_length_mm', label: 'CCL', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'straight_carapace_length_mm', label: 'Cflat', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'carapace_width_mm', label: 'Cwidth', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'curved_plastron_length_mm', label: 'PlasCL', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'straight_plastron_length_mm', label: 'Pflat', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'plastron_p1_mm', label: 'P1', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'plastron_p2_mm', label: 'P2', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'plastron_width_mm', label: 'Pwidth', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'dome_height_mm', label: 'DomeHeight', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'transmitter_id', label: 'Transmitter ID', placeholder: 'Transmitter ID', type: 'text', span: { base: 12, md: 6 } },
  { key: 'id2', label: 'ID2 (random sequence)', placeholder: 'Secondary ID', type: 'text', span: { base: 12, md: 6 } },
];
