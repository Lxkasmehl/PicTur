/**
 * Microhabitat + flag confirmation for admin review (new or matched turtle).
 * Checkboxes: microhabitat picture uploaded, all other picture angles uploaded.
 * Dropdown: physical flag at position (Yes / No / No flag - ran out).
 * Digital flag: show uploader's if any; admin can set/override via GPS or map.
 */

import { useState } from 'react';
import { Stack, Text, Checkbox, Select, Group, Paper, Button } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconFlag, IconPhoto, IconCurrentLocation, IconMapPin } from '@tabler/icons-react';
import { MapPicker } from './MapPicker.tsx';
import type { FindMetadata } from '../services/api';

const PHYSICAL_FLAG_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'no_flag', label: 'No flag (ran out)' },
];

export interface FindMetadataFormProps {
  value: FindMetadata | null | undefined;
  onChange: (value: FindMetadata) => void;
  /** Show digital flag from uploader (admin can override) */
  digitalFlagFromUpload?: {
    latitude: number;
    longitude: number;
    source?: 'gps' | 'manual';
  };
  /** Callback to get current location (GPS) for digital flag – e.g. from getCurrentLocation() */
  onRequestLocation?: () => Promise<{ latitude: number; longitude: number } | null>;
  /** If true, hide physical flag and digital flag fields (already set on upload page). */
  hideFlagFields?: boolean;
}

export function FindMetadataForm({
  value,
  onChange,
  digitalFlagFromUpload,
  onRequestLocation,
  hideFlagFields = false,
}: FindMetadataFormProps) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const isMobile = useMediaQuery('(max-width: 576px)');
  const microhabitat = value?.microhabitat_uploaded ?? false;
  const otherAngles = value?.other_angles_uploaded ?? false;
  const physicalFlag = value?.physical_flag ?? '';

  const update = (patch: Partial<FindMetadata>) => {
    onChange({ ...value, ...patch } as FindMetadata);
  };

  const effectiveDigitalFlag =
    value?.digital_flag_lat != null && value?.digital_flag_lon != null
      ? {
          lat: value.digital_flag_lat,
          lon: value.digital_flag_lon,
          source: value.digital_flag_source,
          isOverride: true,
        }
      : digitalFlagFromUpload
        ? {
            lat: digitalFlagFromUpload.latitude,
            lon: digitalFlagFromUpload.longitude,
            source: digitalFlagFromUpload.source,
            isOverride: false,
          }
        : null;

  const handleUseMyLocation = async () => {
    if (!onRequestLocation) return;
    setGpsLoading(true);
    try {
      const loc = await onRequestLocation();
      if (loc) update({ digital_flag_lat: loc.latitude, digital_flag_lon: loc.longitude, digital_flag_source: 'gps' });
    } finally {
      setGpsLoading(false);
    }
  };

  return (
    <Stack gap="md">
      <Paper p="sm" withBorder radius="md">
        <Group gap="xs" mb="xs">
          <IconPhoto size={18} />
          <Text fw={600} size="sm">
            Photos &amp; flag (for research team)
          </Text>
        </Group>
        <Stack gap="xs">
          <Checkbox
            label="Microhabitat picture of where the turtle was found was uploaded"
            checked={microhabitat}
            onChange={(e) => update({ microhabitat_uploaded: e.currentTarget.checked })}
          />
          <Checkbox
            label="All other picture angles for the turtle were uploaded"
            checked={otherAngles}
            onChange={(e) => update({ other_angles_uploaded: e.currentTarget.checked })}
          />
          {!hideFlagFields && (
            <Select
              label="Physical flag at position? (Turtle returned to exact spot - flag helps.)"
              placeholder={'Select...'}
              leftSection={<IconFlag size={16} />}
              data={PHYSICAL_FLAG_OPTIONS}
              value={physicalFlag || null}
              onChange={(v) => update({ physical_flag: (v as FindMetadata['physical_flag']) || undefined })}
              clearable
              allowDeselect
            />
          )}
        </Stack>
      </Paper>

      {!hideFlagFields && (
      <Paper p="sm" withBorder radius="md">
        <Group gap="xs" mb="xs">
          <IconMapPin size={18} />
          <Text fw={600} size="sm">
            Digital flag (release position)
          </Text>
        </Group>
        <Text size="xs" c="dimmed" mb="xs">
          Set the position where the turtle should be released. Use GPS or pick on the map. Admins and community can both set this.
        </Text>
        <Group gap="xs" mb="xs">
          {onRequestLocation && (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconCurrentLocation size={14} />}
              onClick={handleUseMyLocation}
              loading={gpsLoading}
            >
              Use my location (GPS)
            </Button>
          )}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconMapPin size={14} />}
            onClick={() => {}}
            style={{ pointerEvents: 'none' }}
          >
            Or pick on map below
          </Button>
          {effectiveDigitalFlag && (
            <Button size="xs" variant="subtle" color="gray" onClick={() => update({ digital_flag_lat: undefined, digital_flag_lon: undefined, digital_flag_source: undefined })}>
              Clear
            </Button>
          )}
        </Group>
        <MapPicker
          height={isMobile ? 220 : 260}
          value={
            effectiveDigitalFlag
              ? { lat: effectiveDigitalFlag.lat, lon: effectiveDigitalFlag.lon }
              : null
          }
          onChange={(lat, lon) => update({ digital_flag_lat: lat, digital_flag_lon: lon, digital_flag_source: 'manual' })}
        />
        {effectiveDigitalFlag && (
          <Text size="xs" c="dimmed" mt="xs">
            {effectiveDigitalFlag.lat.toFixed(5)}, {effectiveDigitalFlag.lon.toFixed(5)}
            {effectiveDigitalFlag.source ? ` (${effectiveDigitalFlag.source})` : ''}
            {effectiveDigitalFlag.isOverride && ' – admin set'}
          </Text>
        )}
      </Paper>
      )}
    </Stack>
  );
}
