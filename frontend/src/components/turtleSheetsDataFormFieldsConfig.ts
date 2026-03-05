/**
 * Field configuration for TurtleSheetsDataForm (order and layout)
 */

import type { TurtleSheetsData } from '../services/api';

/** Guided indicators for assessing turtle health (shown in Health Status tooltip). */
export const HEALTH_STATUS_INFO_TOOLTIP =
  'When assessing turtle health, consider noting:\n• Mucous discharge from eyes or nose\n• Dull or fragmented iris / eye coloration\n• Burn damage on the shell\n• Structural bone damage (including exposed bone)\n• Missing appendages or tail\n• Signs of dehydration\n• Presence of flesh flies\n• Presence of mites';

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
  { key: 'id', label: 'ID', placeholder: 'Original ID', description: 'Original turtle ID (may not be unique across sheets)', type: 'text', span: { base: 12, md: 6 } },
  { key: 'id2', label: 'ID2 (random sequence)', placeholder: 'Secondary ID', type: 'text', span: { base: 12, md: 6 } },
  { key: 'transmitter_id', label: 'Transmitter ID', placeholder: 'Transmitter ID', type: 'text', span: { base: 12, md: 6 } },
  { key: 'transmitter_type', label: 'Transmitter Type', placeholder: 'Transmitter type', type: 'text', span: { base: 12, md: 6 } },
  { key: 'name', label: 'Name', placeholder: 'Turtle name', type: 'text', span: { base: 12, md: 4 } },
  { key: 'sex', label: 'Sex', placeholder: 'Select sex', type: 'select', selectData: ['F', 'M', 'J', 'U'], span: { base: 12, md: 4 } },
  { key: 'species', label: 'Species', placeholder: 'Species', type: 'text', span: { base: 12, md: 4 } },
  { key: 'date_1st_found', label: 'Date 1st Found', placeholder: 'YYYY-MM-DD', type: 'text', span: { base: 12, md: 6 } },
  // dates_refound rendered separately (append UI)
  { key: 'general_location', label: 'General Location', placeholder: 'General location', type: 'text', span: { base: 12, md: 6 } },
  { key: 'location', label: 'Location', placeholder: 'Specific location', type: 'text', span: { base: 12, md: 6 } },
  {
    key: 'health_status',
    label: 'Health Status',
    placeholder: 'Describe health observations (e.g. eye/nose discharge, shell damage, dehydration)',
    type: 'textarea',
    infoTooltip: HEALTH_STATUS_INFO_TOOLTIP,
    span: { base: 12, md: 12 },
  },
  // Optional mass and morphometrics
  { key: 'mass_g', label: 'Mass (g)', placeholder: 'e.g. 250', description: 'Body mass in grams', type: 'text', span: { base: 12, md: 4 } },
  { key: 'curved_carapace_length_mm', label: 'Curved carapace length (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'straight_carapace_length_mm', label: 'Straight carapace length (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'carapace_width_mm', label: 'Carapace width (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'curved_plastron_length_mm', label: 'Curved plastron length (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'straight_plastron_length_mm', label: 'Straight plastron length (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'plastron_width_mm', label: 'Plastron width (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'dome_height_mm', label: 'Dome height (mm)', placeholder: 'mm', type: 'text', span: { base: 12, md: 4 } },
  { key: 'pit', label: 'Pit?', placeholder: 'Yes/No', type: 'select', selectData: ['Yes', 'No'], span: { base: 12, md: 3 } },
  { key: 'pic_in_2024_archive', label: 'Pic in 2024 Archive?', placeholder: 'Yes/No', type: 'select', selectData: ['Yes', 'No'], span: { base: 12, md: 3 } },
  { key: 'adopted', label: 'Adopted?', placeholder: 'Yes/No', type: 'select', selectData: ['Yes', 'No'], span: { base: 12, md: 3 } },
  { key: 'ibutton', label: 'iButton?', placeholder: 'Yes/No', type: 'select', selectData: ['Yes', 'No'], span: { base: 12, md: 3 } },
  { key: 'dna_extracted', label: 'DNA Extracted?', placeholder: 'Yes/No', type: 'select', selectData: ['Yes', 'No'], span: { base: 12, md: 3 } },
  { key: 'ibutton_last_set', label: 'iButton Last Set', placeholder: 'Date', type: 'text', span: { base: 12, md: 3 } },
  { key: 'last_assay_date', label: 'Last Assay Date', placeholder: 'YYYY-MM-DD', description: 'Date last brought in for assays', type: 'text', span: { base: 12, md: 3 } },
  { key: 'transmitter_lifespan', label: 'Transmitter Lifespan', placeholder: 'Lifespan', type: 'text', span: { base: 12, md: 3 } },
  { key: 'transmitter_on_date', label: 'Transmitter On Date', placeholder: 'Date', type: 'text', span: { base: 12, md: 6 } },
  { key: 'radio_replace_date', label: 'Radio Replace Date', placeholder: 'Date', type: 'text', span: { base: 12, md: 6 } },
  { key: 'transmitter_put_on_by', label: 'Transmitter Put On By', placeholder: 'Name', type: 'text', span: { base: 12, md: 6 } },
  { key: 'old_frequencies', label: 'OLD Frequencies', placeholder: 'Frequencies', type: 'text', span: { base: 12, md: 6 } },
];
