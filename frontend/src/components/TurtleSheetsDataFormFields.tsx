/**
 * Form field columns for TurtleSheetsDataForm (fragment of Grid.Col; parent provides Grid)
 */

import { Grid, TextInput, Textarea, Button } from '@mantine/core';
import type { TurtleSheetsData } from '../services/api';
import { TurtleFormField } from './TurtleFormField';
import { TURTLE_SHEETS_FORM_FIELDS } from './turtleSheetsDataFormFieldsConfig';
import type { FieldSpan } from './turtleSheetsDataFormFieldsConfig';
import { CommunityLocationHint } from './TurtleSheetsDataFormSections';
import type { TurtleSheetsDataFormFieldsProps } from './TurtleSheetsDataForm.types';

const FORM_FIELD_ORDER: (keyof TurtleSheetsData | '__dates_refound__' | '__community_hint__' | '__notes__')[] = [
  'id',
  'id2',
  'transmitter_id',
  'transmitter_type',
  'name',
  'sex',
  'species',
  'date_1st_found',
  '__dates_refound__',
  '__community_hint__',
  'general_location',
  'location',
  'health_status',
  'mass_g',
  'curved_carapace_length_mm',
  'straight_carapace_length_mm',
  'carapace_width_mm',
  'curved_plastron_length_mm',
  'straight_plastron_length_mm',
  'plastron_width_mm',
  'dome_height_mm',
  'pit',
  'pic_in_2024_archive',
  'adopted',
  'ibutton',
  'dna_extracted',
  'ibutton_last_set',
  'last_assay_date',
  'transmitter_lifespan',
  'transmitter_on_date',
  'radio_replace_date',
  'transmitter_put_on_by',
  'old_frequencies',
  '__notes__',
];

const configByKey = Object.fromEntries(
  TURTLE_SHEETS_FORM_FIELDS.map((c) => [c.key, c]),
) as Record<keyof TurtleSheetsData, (typeof TURTLE_SHEETS_FORM_FIELDS)[0]>;

export type { TurtleSheetsDataFormFieldsProps } from './TurtleSheetsDataForm.types';

function toSpan(span: FieldSpan) {
  return typeof span === 'number' ? span : span;
}

export function TurtleSheetsDataFormFields({
  formData,
  handleChange,
  isFieldModeRestricted,
  isFieldUnlocked,
  requestUnlock,
  additionalDatesRefound,
  setAdditionalDatesRefound,
  additionalNotes,
  setAdditionalNotes,
  primaryId,
  hintLocationFromCommunity,
  hintCoordinates,
  errors,
  mode,
  requireGeneralLocationForPath = false,
  requireNewSheetForCommunityMatch = false,
  generalLocationUseCatalog,
  generalLocationOptions = [],
  generalLocationLoading = false,
  generalLocationLocked = false,
  generalLocationStateLabel = '',
  onCreateGeneralLocation,
  generalLocationSelectRemountKey,
}: TurtleSheetsDataFormFieldsProps) {
  // When moving community turtle to admin, sheet and general_location must be editable without unlock
  const effectiveRestrictedForField = (field: keyof TurtleSheetsData) =>
    requireNewSheetForCommunityMatch && field === 'general_location' ? false : isFieldModeRestricted;
  return (
    <>
      {primaryId && (
        <Grid.Col span={12}>
          <TextInput
            label='Primary ID'
            value={primaryId}
            disabled
            description='Automatically generated unique identifier'
          />
        </Grid.Col>
      )}

      {FORM_FIELD_ORDER.map((key) => {
        if (key === '__dates_refound__') {
          return (
            <Grid.Col key="dates_refound" span={{ base: 12, md: 6 }}>
              {isFieldModeRestricted ? (
                <>
                  <TextInput
                    label='Dates Refound (existing)'
                    value={formData.dates_refound || ''}
                    disabled
                    description='Read-only; add new dates below'
                  />
                  <TextInput
                    label='Add dates refound'
                    placeholder='Comma-separated dates to append'
                    value={additionalDatesRefound}
                    onChange={(e) => setAdditionalDatesRefound(e.target.value)}
                    description='New dates will be appended to the list'
                    mt='xs'
                  />
                </>
              ) : (
                <TextInput
                  label='Dates Refound'
                  placeholder='Comma-separated dates'
                  value={formData.dates_refound || ''}
                  onChange={(e) => handleChange('dates_refound', e.target.value)}
                />
              )}
            </Grid.Col>
          );
        }

        if (key === '__community_hint__') {
          if (!hintLocationFromCommunity && !hintCoordinates) return null;
          return (
            <Grid.Col key="community_hint" span={12}>
              <CommunityLocationHint
                hintLocationFromCommunity={hintLocationFromCommunity}
                hintCoordinates={hintCoordinates}
              />
            </Grid.Col>
          );
        }

        if (key === '__notes__') {
          return (
            <Grid.Col key="notes" span={12}>
              {isFieldModeRestricted ? (
                <>
                  <Textarea
                    label='Notes (existing)'
                    value={formData.notes || ''}
                    disabled
                    minRows={2}
                    description='Read-only; add new notes below'
                  />
                  <Textarea
                    label='Additional notes'
                    placeholder='New notes to append'
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    minRows={3}
                    description='New notes will be appended to existing notes'
                    mt='xs'
                  />
                </>
              ) : (
                <Textarea
                  label='Notes'
                  placeholder='Additional notes'
                  value={formData.notes || ''}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  minRows={3}
                />
              )}
            </Grid.Col>
          );
        }

        const config = configByKey[key];
        if (!config) return null;

        const span = toSpan(config.span);
        const value = formData[config.key] ?? '';
        const isGeneralLocationField = config.key === 'general_location';
        const generalLocationAsSelect = isGeneralLocationField && generalLocationUseCatalog;
        const generalLocationDescription =
          generalLocationAsSelect && generalLocationStateLabel
            ? generalLocationLocked
              ? `Auto-filled from the sheet rule for ${generalLocationStateLabel}.`
              : `Select a General Location for ${generalLocationStateLabel}, or add a new one.`
            : isGeneralLocationField && !generalLocationUseCatalog
              ? 'Optional. Free text; not used for the research spreadsheet folder path.'
              : config.key === 'general_location' && requireGeneralLocationForPath
                ? 'Required for backend path (State/Location).'
                : config.description;

        return (
          <Grid.Col key={config.key} span={span}>
            <TurtleFormField
              field={config.key}
              label={config.label}
              placeholder={config.placeholder}
              description={
                config.key === 'id' && mode === 'create'
                  ? 'Auto-generated from sex + sequence for this sheet (e.g. M1, F2)'
                  : generalLocationDescription
              }
              infoTooltip={config.infoTooltip}
              value={value}
              onChange={(v) => handleChange(config.key, v)}
              type={generalLocationAsSelect ? 'select' : config.type}
              selectData={generalLocationAsSelect ? generalLocationOptions : config.selectData}
              isFieldModeRestricted={effectiveRestrictedForField(config.key)}
              isFieldUnlocked={isFieldUnlocked}
              requestUnlock={requestUnlock}
              disabled={
                config.key === 'id' ||
                (generalLocationAsSelect && (generalLocationLocked || generalLocationLoading))
              }
              error={errors?.[config.key]}
              required={config.key === 'general_location' ? requireGeneralLocationForPath : undefined}
              searchable={generalLocationAsSelect}
              selectRemountKey={generalLocationAsSelect ? generalLocationSelectRemountKey : undefined}
              afterInput={
                generalLocationAsSelect && onCreateGeneralLocation && !generalLocationLocked ? (
                  <Button
                    variant='subtle'
                    size='compact-xs'
                    mt='xs'
                    onClick={onCreateGeneralLocation}
                    disabled={generalLocationLoading}
                  >
                    + Add new General Location
                  </Button>
                ) : undefined
              }
            />
          </Grid.Col>
        );
      })}
    </>
  );
}
