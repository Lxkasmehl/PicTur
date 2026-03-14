/**
 * Reusable sections for TurtleSheetsDataForm: header, sheet row, modals, community hint
 */

import {
  Stack,
  TextInput,
  Select,
  NativeSelect,
  Group,
  Button,
  Alert,
  Text,
  Title,
  Loader,
  Modal,
  Anchor,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconInfoCircle, IconLockOpen, IconMapPin } from '@tabler/icons-react';
import { MapDisplay } from './MapDisplay';
import type { TurtleSheetsData } from '../services/api';

export function FormHeader({
  mode,
  primaryId,
}: {
  mode: 'create' | 'edit';
  primaryId?: string;
}) {
  return (
    <div>
      <Title order={3}>Turtle Data - Google Sheets</Title>
      <Text size='sm' c='dimmed' mt='xs'>
        {mode === 'create'
          ? 'Enter turtle data to add to Google Sheets'
          : 'Edit turtle data in Google Sheets'}
      </Text>
      {primaryId && (
        <Text size='sm' c='dimmed' mt='xs'>
          Primary ID: <strong>{primaryId}</strong>
        </Text>
      )}
    </div>
  );
}

export function SheetSelectionRow({
  loadingSheets,
  isFieldModeRestricted,
  isFieldUnlocked,
  requestUnlock,
  selectedSheetName,
  setSelectedSheetName,
  availableSheets,
  setShowCreateSheetModal,
  allowCreateNewSheet = true,
}: {
  loadingSheets: boolean;
  isFieldModeRestricted: boolean;
  isFieldUnlocked: (field: keyof TurtleSheetsData) => boolean;
  requestUnlock: (field: keyof TurtleSheetsData) => void;
  selectedSheetName: string;
  setSelectedSheetName: (v: string) => void;
  availableSheets: string[];
  setShowCreateSheetModal: (v: boolean) => void;
  allowCreateNewSheet?: boolean;
}) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const sheetOptionsForSelect = [
    ...availableSheets.map((name) => ({ value: name, label: name })),
    ...(allowCreateNewSheet !== false ? [{ value: '__create_new__' as const, label: '+ Create New Sheet' }] : []),
  ];
  const sheetOptionsForNative = [
    { value: '', label: 'Select a sheet or create new' },
    ...sheetOptionsForSelect,
  ];

  if (loadingSheets) {
    return (
      <Group gap='sm'>
        <Loader size='sm' />
        <Text size='sm' c='dimmed'>
          Loading available sheets...
        </Text>
      </Group>
    );
  }

  if (isFieldModeRestricted && !isFieldUnlocked('sheet_name')) {
    return (
      <>
        <Group gap='xs' mb={4}>
          <Button
            variant='subtle'
            size='compact-xs'
            leftSection={<IconLockOpen size={14} />}
            onClick={() => requestUnlock('sheet_name')}
          >
            Unlock editing
          </Button>
        </Group>
        <TextInput
          label='Sheet / Location'
          value={selectedSheetName}
          disabled
          description='Select the Google Sheets tab where this turtle data should be stored'
        />
      </>
    );
  }

  const handleSheetChange = (value: string | null) => {
    const v = value ?? '';
    if (v === '__create_new__') {
      setShowCreateSheetModal(true);
      setSelectedSheetName('');
    } else {
      setSelectedSheetName(v);
    }
  };

  if (isMobile) {
    return (
      <NativeSelect
        label='Sheet / Location'
        data={sheetOptionsForNative}
        value={selectedSheetName}
        onChange={(e) => handleSheetChange(e.currentTarget.value || null)}
        required
        description='Select the Google Sheets tab where this turtle data should be stored'
        error={!selectedSheetName ? 'Sheet selection is required' : undefined}
      />
    );
  }

  return (
    <Select
      label='Sheet / Location'
      placeholder='Select a sheet or create new'
      data={sheetOptionsForSelect}
      value={selectedSheetName}
      onChange={handleSheetChange}
      required
      allowDeselect={false}
      description='Select the Google Sheets tab where this turtle data should be stored'
      error={!selectedSheetName ? 'Sheet selection is required' : undefined}
      searchable
      comboboxProps={{ keepMounted: true }}
    />
  );
}

export function CommunityLocationHint({
  hintLocationFromCommunity,
  hintCoordinates,
}: {
  hintLocationFromCommunity?: string;
  hintCoordinates?: { latitude: number; longitude: number; source?: 'gps' | 'manual' };
}) {
  return (
    <Alert
      variant='light'
      color='blue'
      icon={<IconInfoCircle size={16} />}
      title='Community member indicated'
    >
      <Stack gap='xs'>
        {hintLocationFromCommunity && (
          <Text size='sm'>
            Location: {hintLocationFromCommunity} (for reference only; not pre-filled)
          </Text>
        )}
        {hintCoordinates && (
          <>
            <Text size='sm'>
              Coordinates: {hintCoordinates.latitude.toFixed(5)},{' '}
              {hintCoordinates.longitude.toFixed(5)}
              {hintCoordinates.source && ` (${hintCoordinates.source})`}
            </Text>
            <MapDisplay
              latitude={hintCoordinates.latitude}
              longitude={hintCoordinates.longitude}
              height={200}
              zoom={15}
            />
            <Anchor
              size='sm'
              href={`https://www.openstreetmap.org/?mlat=${hintCoordinates.latitude}&mlon=${hintCoordinates.longitude}&zoom=17`}
              target='_blank'
              rel='noopener noreferrer'
            >
              <Group gap={4} wrap='nowrap'>
                <IconMapPin size={14} />
                <span>Open in OpenStreetMap</span>
              </Group>
            </Anchor>
          </>
        )}
      </Stack>
    </Alert>
  );
}

export function UnlockConfirmModal({
  opened,
  onClose,
  onConfirm,
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title='Unlock editing'>
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          Editing existing data can affect data integrity and may overwrite or remove
          information. Are you sure you want to allow editing this field?
        </Text>
        <Group justify='flex-end' gap='sm'>
          <Button variant='default' onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconLockOpen size={16} />} onClick={onConfirm}>
            I understand, unlock editing
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function CreateSheetModal({
  opened,
  onClose,
  newSheetName,
  setNewSheetName,
  creatingSheet,
  onCreate,
}: {
  opened: boolean;
  onClose: () => void;
  newSheetName: string;
  setNewSheetName: (v: string) => void;
  creatingSheet: boolean;
  onCreate: (name: string) => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title='Create New Sheet'
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          Create a new Google Sheets tab with all required headers.
        </Text>
        <TextInput
          label='Sheet Name'
          placeholder='Enter sheet name (e.g., Location A)'
          value={newSheetName}
          onChange={(e) => setNewSheetName(e.target.value)}
          required
        />
        <Group justify='flex-end' gap='md'>
          <Button variant='subtle' onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onCreate(newSheetName)}
            loading={creatingSheet}
            disabled={!newSheetName.trim() || creatingSheet}
          >
            Create Sheet
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
