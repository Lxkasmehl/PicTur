import { Divider, Modal, Paper, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function CreateNewTurtleModal() {
  const isMobile = useMediaQuery('(max-width: 576px)');
  const {
    imageId,
    packetItem,
    showNewTurtleModal,
    setShowNewTurtleModal,
    newTurtlePrimaryId,
    newTurtleSheetsData,
    newTurtleSheetName,
    availableSheets,
    refreshPacketItem,
    handleSaveNewTurtleSheetsData,
  } = useAdminTurtleMatchContext();

  return (
    <Modal
      opened={showNewTurtleModal}
      onClose={() => setShowNewTurtleModal(false)}
      title='Create New Turtle'
      size={isMobile ? '100%' : 'xl'}
      centered
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          Create a new turtle entry for this uploaded image. Select a sheet and fill in the
          turtle data below. Primary ID will be automatically generated. ID and ID2 can be
          entered manually if needed.
        </Text>

        {newTurtlePrimaryId && (
          <Paper p='sm' withBorder>
            <Text size='sm' c='dimmed'>
              Primary ID
            </Text>
            <Text fw={500}>{newTurtlePrimaryId}</Text>
          </Paper>
        )}

        {imageId && (
          <Paper p='sm' withBorder radius='md'>
            <AdditionalImagesSection
              title='Photos for this upload'
              embedded
              images={(packetItem?.additional_images ?? []).map((a) => ({
                imagePath: a.image_path,
                filename: a.filename,
                type: a.type,
              }))}
              requestId={imageId}
              onRefresh={refreshPacketItem}
            />
          </Paper>
        )}

        <Divider label='Google Sheets Data' labelPosition='center' />

        <TurtleSheetsDataForm
          initialData={newTurtleSheetsData || undefined}
          sheetName={newTurtleSheetName}
          state={newTurtleSheetsData?.general_location || ''}
          location={newTurtleSheetsData?.location || ''}
          primaryId={newTurtlePrimaryId || undefined}
          mode='create'
          onSave={handleSaveNewTurtleSheetsData}
          onCancel={() => setShowNewTurtleModal(false)}
          useBackendLocations
          sheetSource='admin'
          addOnlyMode
          matchPageColumnLayout
          initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
        />
      </Stack>
    </Modal>
  );
}
