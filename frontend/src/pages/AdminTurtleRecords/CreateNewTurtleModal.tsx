import { Divider, Modal, Paper, Stack, Text } from '@mantine/core';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';

interface CreateNewTurtleModalProps {
  /** Modal size (e.g. from useMediaQuery: isMobile ? '100%' : 'xl') */
  size: string;
}

export function CreateNewTurtleModal({ size }: CreateNewTurtleModalProps) {
  const ctx = useAdminTurtleRecordsContext();
  const {
    showNewTurtleModal: opened,
    setShowNewTurtleModal,
    newTurtlePrimaryId,
    newTurtleSheetsData,
    newTurtleSheetName,
    availableSheets,
    selectedItem,
    handleSaveNewTurtleSheetsData: onSave,
    refreshQueueItem,
  } = ctx;

  const onClose = () => setShowNewTurtleModal(false);
  const onCancel = () => setShowNewTurtleModal(false);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title='Create New Turtle'
      size={size as 'xl' | '100%'}
      centered
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          Create a new turtle entry for this upload. Select a sheet and fill in the
          turtle data below. Primary ID will be automatically generated. ID and ID2 can
          be entered manually if needed.
        </Text>
        {newTurtlePrimaryId && (
          <Paper p='sm' withBorder>
            <Text size='sm' c='dimmed'>
              Primary ID
            </Text>
            <Text fw={500}>{newTurtlePrimaryId}</Text>
          </Paper>
        )}
        {selectedItem?.request_id && (
          <Paper p='sm' withBorder radius='md'>
            <AdditionalImagesSection
              title='Photos for this upload'
              embedded
              images={(selectedItem.additional_images ?? []).map((a) => ({
                imagePath: a.image_path,
                filename: a.filename,
                type: a.type,
              }))}
              requestId={selectedItem.request_id}
              onRefresh={() => refreshQueueItem(selectedItem.request_id)}
            />
          </Paper>
        )}
        <Divider label='Google Sheets Data' labelPosition='center' />
        <TurtleSheetsDataForm
          initialData={newTurtleSheetsData || undefined}
          sheetName={newTurtleSheetName}
          initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
          sheetSource={
            selectedItem?.request_id?.startsWith('admin_') ? 'admin' : 'community'
          }
          hintLocationFromCommunity={
            selectedItem?.metadata?.state && selectedItem?.metadata?.location
              ? `${selectedItem.metadata.state} / ${selectedItem.metadata.location}`
              : selectedItem?.metadata?.state ||
                selectedItem?.metadata?.location ||
                undefined
          }
          hintCoordinates={
            selectedItem?.metadata?.location_hint_lat != null &&
            selectedItem?.metadata?.location_hint_lon != null
              ? {
                  latitude: selectedItem.metadata.location_hint_lat,
                  longitude: selectedItem.metadata.location_hint_lon,
                  source: selectedItem.metadata.location_hint_source,
                }
              : undefined
          }
          primaryId={newTurtlePrimaryId || undefined}
          mode='create'
          onSave={onSave}
          onCancel={onCancel}
        />
      </Stack>
    </Modal>
  );
}
