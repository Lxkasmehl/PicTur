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
  'deceased',
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
 * Turtle Match page: visible columns (Primary ID is shown separately).
 *
 * - **Edit** existing turtle: fields in `TURTLE_MATCH_PAGE_UNLOCKABLE_FIELDS` use unlock-to-edit;
 *   all other visible fields (e.g. **freq**, **species**, **name**) are read-only with no unlock.
 * - **Create** new turtle (Match page modal): the same “non-unlockable on edit” fields use
 *   unlock-to-edit so they can be filled; biology **id** stays auto/disabled; **general_location**
 *   uses unlock-then-catalog-dropdown when editable, or stays disabled when the sheet has a
 *   fixed default (`generalLocationLocked`); **general_location** may stay open when moving from
 *   community (`requireNewSheetForCommunityMatch`).
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
  'deceased',
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

/**
 * On Match **edit**, these fields use unlock + confirm; others in the match column set are hard read-only.
 * **general_location** uses the same unlock flow so the catalog dropdown appears after confirm (not read-only text + “Add new” only).
 */
export const TURTLE_MATCH_PAGE_UNLOCKABLE_FIELDS = new Set<keyof TurtleSheetsData>([
  'dna_extracted',
  'last_assay_date',
  'dates_refound',
  'specific_location',
  'general_location',
  'location',
  'cow_interactions',
  'health_status',
  'deceased',
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
