/**
 * Turtle Sheets Data Form Component
 * Form for entering/editing turtle data that will be synced to Google Sheets
 */

import {
  Stack,
  Group,
  Button,
  Alert,
  Text,
  Grid,
  Paper,
  Loader,
} from '@mantine/core';
import { useImperativeHandle, forwardRef } from 'react';
import { IconInfoCircle, IconSkull } from '@tabler/icons-react';
import { useTurtleSheetsDataForm } from '../hooks/useTurtleSheetsDataForm';
import type { UseTurtleSheetsDataFormReturn } from './TurtleSheetsDataForm.types';
import {
  FormHeader,
  SheetSelectionRow,
  UnlockConfirmModal,
  CreateSheetModal,
  CreateGeneralLocationModal,
} from './TurtleSheetsDataFormSections';
import { TurtleSheetsDataFormFields } from './TurtleSheetsDataFormFields';
import type { TurtleSheetsDataFormProps, TurtleSheetsDataFormRef } from './TurtleSheetsDataForm.types';

export type { TurtleSheetsDataFormRef } from './TurtleSheetsDataForm.types';

function isSheetsDeceasedYes(v?: string): boolean {
  const s = (v || '').trim().toLowerCase();
  return ['yes', 'y', 'true', '1', 'deceased', 'dead'].includes(s);
}

export const TurtleSheetsDataForm = forwardRef<
  TurtleSheetsDataFormRef,
  TurtleSheetsDataFormProps
>(function TurtleSheetsDataForm(
  {
    initialData,
    sheetName: initialSheetName,
    hintLocationFromCommunity,
    hintCoordinates,
    primaryId,
    onSave,
    onCancel,
    mode,
    hideSubmitButton = false,
    onCombinedSubmit,
    addOnlyMode = false,
    initialAvailableSheets,
    useBackendLocations = false,
    sheetSource = 'admin',
    requireNewSheetForCommunityMatch = false,
  },
  ref,
) {
  const hook: UseTurtleSheetsDataFormReturn = useTurtleSheetsDataForm({
    initialData,
    sheetName: initialSheetName,
    hintLocationFromCommunity,
    hintCoordinates,
    primaryId,
    onSave,
    onCancel,
    mode,
    hideSubmitButton,
    onCombinedSubmit,
    addOnlyMode,
    initialAvailableSheets,
    useBackendLocations,
    sheetSource,
    requireNewSheetForCommunityMatch,
  });

  useImperativeHandle(ref, () => ({
    submit: hook.handleSubmit,
  }));

  return (
    <Paper shadow='sm' p='xl' radius='md' withBorder style={{ position: 'relative' }}>
      {hook.loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Stack align='center' gap='md'>
            <Loader size='xl' />
            <Text size='lg' fw={500}>
              {mode === 'create' ? 'Creating' : 'Updating'} turtle data...
            </Text>
          </Stack>
        </div>
      )}

      <Stack
        gap='lg'
        style={{
          opacity: hook.loading ? 0.3 : 1,
          pointerEvents: hook.loading ? 'none' : 'auto',
        }}
      >
        <FormHeader mode={mode} primaryId={primaryId} />

        {isSheetsDeceasedYes(hook.formData.deceased) && (
          <Alert icon={<IconSkull size={18} />} color="gray" title="Recorded as deceased" radius="md">
            <Text size="sm">
              This turtle is marked deceased in Google Sheets (gray row and Deceased? column when present).
            </Text>
          </Alert>
        )}

        <Alert icon={<IconInfoCircle size={18} />} color='blue' radius='md'>
          <Text size='sm'>
            This data will be synced to Google Sheets. Primary ID is automatically
            generated.
          </Text>
        </Alert>

        {hook.isFieldModeRestricted && (
          <Alert color='yellow' radius='md' title='Add-only mode (field use)'>
            <Text size='sm'>
              You can only add data here; existing values are read-only to avoid
              accidental changes. You can append to Notes and Dates Refound. To edit an
              existing field, use &quot;Unlock editing&quot; above that field and
              confirm.
            </Text>
          </Alert>
        )}

          <Grid gutter='md'>
            <Grid.Col span={12}>
              <SheetSelectionRow
                loadingSheets={hook.loadingSheets}
                isFieldModeRestricted={hook.isFieldModeRestricted && !requireNewSheetForCommunityMatch}
                isFieldUnlocked={hook.isFieldUnlocked}
                requestUnlock={hook.requestUnlock}
                selectedSheetName={hook.selectedSheetName}
                setSelectedSheetName={hook.setSelectedSheetName}
                availableSheets={hook.availableSheets}
                setShowCreateSheetModal={hook.setShowCreateSheetModal}
                allowCreateNewSheet
              />
              {requireNewSheetForCommunityMatch && (
                <Text size="xs" c="dimmed" mt={4}>
                  This turtle was found in the community spreadsheet. Select the admin sheet (and location) where it should be stored in the research spreadsheet.
                </Text>
              )}
              {hook.errors.sheet_name && (
                <Text size="sm" c="red" mt={4}>
                  {hook.errors.sheet_name}
                </Text>
              )}
            </Grid.Col>
            <TurtleSheetsDataFormFields
              formData={hook.formData}
              handleChange={hook.handleChange}
              isFieldModeRestricted={hook.isFieldModeRestricted}
              isFieldUnlocked={(field) => hook.isFieldUnlocked(field) || (requireNewSheetForCommunityMatch && field === 'general_location')}
              requestUnlock={hook.requestUnlock}
              additionalDatesRefound={hook.additionalDatesRefound}
              setAdditionalDatesRefound={hook.setAdditionalDatesRefound}
              additionalNotes={hook.additionalNotes}
              setAdditionalNotes={hook.setAdditionalNotes}
              primaryId={primaryId}
              hintLocationFromCommunity={hintLocationFromCommunity}
              hintCoordinates={hintCoordinates}
              errors={hook.errors}
              mode={mode}
              requireGeneralLocationForPath={
                (sheetSource === 'admin' || useBackendLocations) &&
                (mode === 'create' || requireNewSheetForCommunityMatch) &&
                !(useBackendLocations && hook.selectedSheetName.includes('/'))
              }
              requireNewSheetForCommunityMatch={requireNewSheetForCommunityMatch}
              generalLocationUseCatalog={hook.generalLocationUseCatalog}
              generalLocationOptions={hook.generalLocationOptions}
              generalLocationLoading={hook.generalLocationLoading}
              generalLocationLocked={hook.generalLocationLocked}
              generalLocationStateLabel={sheetSource === 'community' ? '' : hook.selectedGeneralLocationState}
              onCreateGeneralLocation={
                sheetSource === 'community' && !useBackendLocations
                  ? undefined
                  : () => hook.setShowCreateGeneralLocationModal(true)
              }
              generalLocationSelectRemountKey={hook.selectedSheetName}
            />
          </Grid>

        {!hideSubmitButton && (
          <Group justify='flex-end' gap='md' mt='md'>
            {onCancel && (
              <Button variant='light' onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              onClick={hook.handleSubmit}
              loading={hook.loading}
              disabled={mode === 'create' && hook.loadingTurtleNames}
            >
              {mode === 'create' && hook.loadingTurtleNames
                ? 'Loading names...'
                : mode === 'create'
                  ? 'Create'
                  : 'Update'}{' '}
              Turtle Data
            </Button>
          </Group>
        )}
      </Stack>

      <UnlockConfirmModal
        opened={hook.unlockConfirmField !== null}
        onClose={() => hook.setUnlockConfirmField(null)}
        onConfirm={hook.confirmUnlock}
      />

      <CreateSheetModal
        opened={hook.showCreateSheetModal}
        onClose={() => {
          hook.setShowCreateSheetModal(false);
          hook.setNewSheetName('');
        }}
        newSheetName={hook.newSheetName}
        setNewSheetName={hook.setNewSheetName}
        creatingSheet={hook.creatingSheet}
        onCreate={hook.handleCreateNewSheet}
      />

      <CreateGeneralLocationModal
        opened={hook.showCreateGeneralLocationModal}
        onClose={() => {
          hook.setShowCreateGeneralLocationModal(false);
          hook.setNewGeneralLocationName('');
        }}
        selectedState={hook.selectedGeneralLocationState}
        newGeneralLocationName={hook.newGeneralLocationName}
        setNewGeneralLocationName={hook.setNewGeneralLocationName}
        creatingGeneralLocation={hook.creatingGeneralLocation}
        onCreate={hook.handleCreateGeneralLocation}
      />
    </Paper>
  );
});
