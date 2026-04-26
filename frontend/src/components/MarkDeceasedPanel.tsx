/**
 * Mark a turtle deceased (or clear) by sheet + biology ID, name, or primary ID — no plastron scan.
 * Used on Home (staff) and can be wrapped in Paper when standalone.
 */

import { useState, useEffect } from 'react';
import {
  Paper,
  Stack,
  Title,
  Text,
  Select,
  TextInput,
  Radio,
  Group,
  Button,
  Alert,
  Loader,
} from '@mantine/core';
import { IconInfoCircle, IconSkull } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { markTurtleDeceased, getTurtleLookupOptions, type TurtleLookupField } from '../services/api';
import { useUser } from '../hooks/useUser';
import { useAvailableSheets } from '../hooks/useAvailableSheets';

type LookupMode = TurtleLookupField;

export interface MarkDeceasedPanelProps {
  /** When true, no outer Paper and no large title (e.g. embedded under Home upload). */
  embedded?: boolean;
}

export function MarkDeceasedPanel({ embedded = false }: MarkDeceasedPanelProps) {
  const { role } = useUser();
  const { sheets: availableSheets, loading: sheetsListLoading } = useAvailableSheets(role);
  const [sheetName, setSheetName] = useState<string>('');
  const [lookupMode, setLookupMode] = useState<LookupMode>('biology_id');
  const [lookupValue, setLookupValue] = useState('');
  const [lookupOptions, setLookupOptions] = useState<string[]>([]);
  const [lookupOptionsLoading, setLookupOptionsLoading] = useState(false);
  const [lookupOptionsHint, setLookupOptionsHint] = useState<string | null>(null);
  const [markDeceased, setMarkDeceased] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lastConflict, setLastConflict] = useState<string | null>(null);

  useEffect(() => {
    const sheet = sheetName.trim();
    if (!sheet) {
      setLookupOptions([]);
      setLookupOptionsLoading(false);
      setLookupOptionsHint(null);
      setLookupValue('');
      return;
    }

    let cancelled = false;
    setLookupOptionsLoading(true);
    setLookupOptionsHint(null);
    setLookupValue('');

    getTurtleLookupOptions(sheet, lookupMode)
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.options)) {
          setLookupOptions(res.options);
          if (res.options.length === 0) {
            setLookupOptionsHint(
              'No values in this column (or the header is missing). Enter the exact cell value manually.',
            );
          }
        } else {
          setLookupOptions([]);
          setLookupOptionsHint(res.error || 'Could not load values from the sheet. Enter manually.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLookupOptions([]);
          setLookupOptionsHint('Could not load values from the sheet. Enter manually.');
        }
      })
      .finally(() => {
        if (!cancelled) setLookupOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sheetName, lookupMode]);

  const lookupLabel =
    lookupMode === 'primary_id' ? 'Primary ID' : lookupMode === 'biology_id' ? 'Biology ID' : 'Name';

  const submit = async () => {
    const sheet = sheetName.trim();
    if (!sheet) {
      notifications.show({ title: 'Sheet required', message: 'Choose the spreadsheet tab (location).', color: 'red' });
      return;
    }
    const v = lookupValue.trim();
    if (!v) {
      notifications.show({
        title: `${lookupLabel} required`,
        message:
          lookupOptions.length > 0
            ? 'Select a value from the list (search if the list is long).'
            : 'Enter the value to look up.',
        color: 'red',
      });
      return;
    }
    setSubmitting(true);
    setLastConflict(null);
    try {
      const body: Parameters<typeof markTurtleDeceased>[0] = {
        sheet_name: sheet,
        deceased: markDeceased,
      };
      if (lookupMode === 'primary_id') body.primary_id = v;
      else if (lookupMode === 'biology_id') body.biology_id = v;
      else body.name = v;

      const res = await markTurtleDeceased(body);
      notifications.show({
        title: res.success ? 'Updated' : 'Done',
        message:
          res.message ||
          `Primary ID ${res.primary_id}: Deceased? = ${res.deceased}`,
        color: 'green',
      });
      setLookupValue('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      if (msg.includes('Multiple rows match')) {
        setLastConflict(msg);
      }
      notifications.show({ title: 'Error', message: msg, color: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  const inner = (
    <Stack gap="md">
      {!embedded && (
        <Group gap="sm">
          <IconSkull size={28} stroke={1.5} />
          <div>
            <Title order={3}>Mark deceased (no plastron match)</Title>
            <Text size="sm" c="dimmed">
              Find a turtle in one sheet by Primary ID, biology ID (e.g. F1, M2), or exact name. The sheet row is
              shaded gray when marked deceased; the &quot;Deceased?&quot; column is created automatically if missing.
            </Text>
          </div>
        </Group>
      )}
      {embedded && (
        <Text size="sm" c="dimmed">
          For mortalities you cannot scan (e.g. remains ID&apos;d by transmitter or notes): pick the Google Sheet tab,
          then choose biology ID, name, or Primary ID from the values in that sheet (searchable list). Use the normal
          upload flow when you still have a usable plastron photo.
        </Text>
      )}

      <Alert icon={<IconInfoCircle size={18} />} color="blue" variant="light">
        After a normal plastron upload and match, set &quot;Deceased?&quot; on the turtle form in Turtle Records
        instead.
      </Alert>

      <Select
        label="Spreadsheet tab (location)"
        placeholder={sheetsListLoading ? 'Loading…' : 'Select sheet'}
        data={availableSheets.map((sheet: string) => ({ value: sheet, label: sheet }))}
        value={sheetName}
        onChange={(v: string | null) => setSheetName(v ?? '')}
        searchable
        disabled={sheetsListLoading}
        required
      />

      <Radio.Group
        label="Find turtle by"
        value={lookupMode}
        onChange={(v) => setLookupMode(v as LookupMode)}
      >
        <Stack gap="xs" mt="xs">
          <Radio value="biology_id" label="Biology ID (ID column: F1, M2, …)" />
          <Radio value="name" label="Name (exact match, case-insensitive)" />
          <Radio value="primary_id" label="Primary ID (internal sheet ID)" />
        </Stack>
      </Radio.Group>

      {!sheetName.trim() ? (
        <Text size="sm" c="dimmed">
          Select a sheet tab first to load values for this column.
        </Text>
      ) : lookupOptionsLoading ? (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading values from this sheet…
          </Text>
        </Group>
      ) : lookupOptions.length > 0 ? (
        <Select
          label={lookupLabel}
          placeholder="Search and select a row from this sheet"
          description="Only values that exist in this tab are listed — avoids typos."
          data={lookupOptions}
          value={lookupValue}
          onChange={(v: string | null) => setLookupValue(v ?? '')}
          searchable
          clearable
          nothingFoundMessage="No matching value — try another search"
          maxDropdownHeight={280}
          disabled={submitting}
        />
      ) : (
        <Stack gap="xs">
          {lookupOptionsHint && (
            <Text size="sm" c="orange">
              {lookupOptionsHint}
            </Text>
          )}
          <TextInput
            label={lookupLabel}
            placeholder={
              lookupMode === 'biology_id' ? 'e.g. F1 or M12' : lookupMode === 'name' ? 'Turtle name' : 'Primary ID'
            }
            description="Type the exact value as it appears in Google Sheets."
            value={lookupValue}
            onChange={(e) => setLookupValue(e.target.value)}
            disabled={submitting}
          />
        </Stack>
      )}

      <Radio.Group
        label="Action"
        value={markDeceased ? 'yes' : 'no'}
        onChange={(v) => setMarkDeceased(v === 'yes')}
      >
        <Group mt="xs">
          <Radio value="yes" label="Mark as deceased (Deceased? = Yes, gray row)" />
          <Radio value="no" label="Clear deceased (Deceased? = No, white row)" />
        </Group>
      </Radio.Group>

      {lastConflict && (
        <Alert color="orange" title="Ambiguous name">
          {lastConflict}. Use biology ID or Primary ID if more than one turtle shares the name.
        </Alert>
      )}

      <Button leftSection={<IconSkull size={18} />} onClick={submit} loading={submitting}>
        Apply
      </Button>
    </Stack>
  );

  if (embedded) {
    return inner;
  }

  return (
    <Paper shadow="sm" p="lg" radius="md" withBorder>
      {inner}
    </Paper>
  );
}
