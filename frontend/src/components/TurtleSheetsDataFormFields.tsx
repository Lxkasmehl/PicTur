/**
 * Form field columns for TurtleSheetsDataForm (fragment of Grid.Col; parent provides Grid)
 */

import { Grid, TextInput, Textarea } from '@mantine/core';
import type { TurtleSheetsData } from '../services/api';
import { TurtleFormField } from './TurtleFormField';
import type { TurtleFormFieldProps } from './TurtleFormField.types';
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
  errors?: Record<string, string>;
  /** In create mode the ID field is always disabled and filled by generate-id (sex + sequence per sheet). */
  mode?: 'create' | 'edit';
}

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
}: TurtleSheetsDataFormFieldsProps) {
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

        return (
          <Grid.Col key={config.key} span={span}>
            <TurtleFormField
              field={config.key}
              label={config.label}
              placeholder={config.placeholder}
              description={
                config.key === 'id' && mode === 'create'
                  ? 'Auto-generated from sex + sequence for this sheet (e.g. M1, F2)'
                  : config.description
              }
              infoTooltip={config.infoTooltip}
              value={value}
              onChange={(v) => handleChange(config.key, v)}
              type={config.type}
              selectData={config.selectData}
              isFieldModeRestricted={isFieldModeRestricted}
              isFieldUnlocked={isFieldUnlocked}
              requestUnlock={requestUnlock}
              disabled={config.key === 'id' && mode === 'create'}
              error={errors?.[config.key]}
            />
          </Grid.Col>
        );
      })}
    </>
  );
}
