/**
 * Column order for TurtleSheetsDataForm: full sheet vs Turtle Match subset.
 */

import type { TurtleSheetsData } from '../services/api';

export type TurtleFormOrderKey =
  | keyof TurtleSheetsData
  | '__dates_refound__'
  | '__community_hint__'
  | '__notes__';

/** Matches research spreadsheet column order (Turtle Records + Sheets Browser). */
export const FULL_SHEET_FORM_FIELD_ORDER: TurtleFormOrderKey[] = [
  'freq',
  'id',
  'pit',
  'plastron_picture_in_archive',
  'carapace_picture_in_archive',
  'adopted',
  'ibutton',
  'dna_extracted',
  'date_1st_found',
  'species',
  'name',
  'sex',
  'ibutton_last_set',
  '__dates_refound__',
  'specific_location',
  'general_location',
  'location',
  '__community_hint__',
  'cow_interactions',
  'health_status',
  '__notes__',
  'transmitter_put_on_by',
  'transmitter_on_date',
  'transmitter_type',
  'transmitter_lifespan',
  'radio_replace_date',
  'old_frequencies',
  'flesh_flies',
  'mass_g',
  'curved_carapace_length_mm',
  'straight_carapace_length_mm',
  'carapace_width_mm',
  'curved_plastron_length_mm',
  'straight_plastron_length_mm',
  'plastron_p1_mm',
  'plastron_p2_mm',
  'plastron_width_mm',
  'dome_height_mm',
  'transmitter_id',
  'id2',
];

/**
 * Turtle Match page: visible columns when editing an existing turtle (Primary ID is shown separately).
 */
export const TURTLE_MATCH_PAGE_FORM_ORDER: TurtleFormOrderKey[] = [
  'freq',
  'id',
  'plastron_picture_in_archive',
  'carapace_picture_in_archive',
  'dna_extracted',
  'date_1st_found',
  'species',
  'name',
  'sex',
  'last_assay_date',
  '__dates_refound__',
  'specific_location',
  'general_location',
  'location',
  '__community_hint__',
  'cow_interactions',
  'health_status',
  '__notes__',
  'radio_replace_date',
  'flesh_flies',
  'mass_g',
  'curved_carapace_length_mm',
  'straight_carapace_length_mm',
  'carapace_width_mm',
  'curved_plastron_length_mm',
  'straight_plastron_length_mm',
  'plastron_p1_mm',
  'plastron_p2_mm',
  'plastron_width_mm',
  'dome_height_mm',
];

/** Fields that require unlock + confirm before editing on the Match page. */
export const TURTLE_MATCH_PAGE_UNLOCKABLE_FIELDS = new Set<keyof TurtleSheetsData>([
  'dna_extracted',
  'last_assay_date',
  'dates_refound',
  'specific_location',
  'location',
  'cow_interactions',
  'health_status',
  'notes',
  'flesh_flies',
  'mass_g',
  'curved_carapace_length_mm',
  'straight_carapace_length_mm',
  'carapace_width_mm',
  'curved_plastron_length_mm',
  'straight_plastron_length_mm',
  'plastron_p1_mm',
  'plastron_p2_mm',
  'plastron_width_mm',
  'dome_height_mm',
]);
