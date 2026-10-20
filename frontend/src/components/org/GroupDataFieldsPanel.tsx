import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { publishTurtleColumns } from '../../hooks/useTurtleColumns';
import {
  columnsInputFrom,
  getTurtleColumns,
  setTurtleColumns,
  type StandardColumn,
  type TurtleColumnsInput,
} from '../../services/api/turtleColumns';
import { TurtleColumnsEditor } from './TurtleColumnsEditor';

/** Group admins: which turtle data fields their research group records. */
export function GroupDataFieldsPanel({ slug }: { slug: string }) {
  const [standard, setStandard] = useState<StandardColumn[] | null>(null);
  const [saved, setSaved] = useState<TurtleColumnsInput | null>(null);
  const [value, setValue] = useState<TurtleColumnsInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTurtleColumns(slug)
      .then((res) => {
        if (cancelled) return;
        const input = columnsInputFrom(res.standard, res.custom);
        setStandard(res.standard);
        setSaved(input);
        setValue(input);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(value);

  const save = async () => {
    if (!value) return;
    setBusy(true);
    try {
      const res = await setTurtleColumns(value, slug);
      const input = columnsInputFrom(res.standard, res.custom);
      setStandard(res.standard);
      setSaved(input);
      setValue(input);
      publishTurtleColumns(slug, res);
      notifications.show({
        color: res.warning ? 'orange' : 'green',
        icon: <IconCheck size={18} />,
        title: 'Data fields saved',
        message: res.warning ?? 'The turtle forms of this group now show these fields.',
      });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not save', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p='md' radius='md' data-testid='group-data-fields'>
      <Stack gap='sm'>
        <div>
          <Text fw={500}>Turtle data fields</Text>
          <Text size='sm' c='dimmed'>
            Choose what your group records about each turtle. The fields of the original PicTur group are the template.
          </Text>
        </div>
        {error && <Alert color='red'>{error}</Alert>}
        {!error && (!standard || !value) && <Loader size='sm' />}
        {standard && value && (
          <>
            <TurtleColumnsEditor standard={standard} value={value} onChange={setValue} disabled={busy} />
            <Group justify='flex-end'>
              <Button variant='default' disabled={!dirty || busy} onClick={() => setValue(saved)}>
                Reset
              </Button>
              <Button disabled={!dirty} loading={busy} onClick={save} data-testid='group-data-fields-save'>
                Save fields
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
