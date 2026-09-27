import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { OrgGate } from '../../components/org/OrgGate';
import type { OrgOption } from '../../hooks/useActiveOrg';
import {
  createRegion,
  deleteRegion,
  getRegions,
  regionOptions,
  renameRegion,
  type Region,
} from '../../services/api/orgData';

export default function OrgRegionsPage() {
  return <OrgGate minRole='admin'>{(org) => <RegionsManager org={org} />}</OrgGate>;
}

function RegionsManager({ org }: { org: OrgOption }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getRegions(org.slug).then(setRegions).catch(() => setRegions([]));
  }, [org.slug]);
  useEffect(load, [load]);

  const children = useMemo(() => {
    const map = new Map<number | null, Region[]>();
    for (const r of regions) {
      const list = map.get(r.parent_id) ?? [];
      list.push(r);
      map.set(r.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [regions]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Action failed', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    act(async () => {
      await createRegion(org.slug, name.trim(), parent ? Number(parent) : null);
      setName('');
    });

  const renderNode = (r: Region, depth: number): React.ReactNode => (
    <Stack key={r.id} gap={4}>
      <Group gap='xs' pl={depth * 24} wrap='nowrap'>
        {editing?.id === r.id ? (
          <>
            <TextInput size='xs' value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.currentTarget.value })} />
            <ActionIcon size='sm' variant='subtle' aria-label='Save' onClick={() => act(async () => { await renameRegion(org.slug, r.id, editing.name.trim()); setEditing(null); })}>
              <IconCheck size={14} />
            </ActionIcon>
            <ActionIcon size='sm' variant='subtle' color='gray' aria-label='Cancel' onClick={() => setEditing(null)}>
              <IconX size={14} />
            </ActionIcon>
          </>
        ) : (
          <>
            <Text>{r.name}</Text>
            <Tooltip label='Rename'>
              <ActionIcon size='sm' variant='subtle' aria-label='Rename' onClick={() => setEditing({ id: r.id, name: r.name })}>
                <IconPencil size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label='Delete (only when unused)'>
              <ActionIcon size='sm' variant='subtle' color='red' aria-label='Delete' onClick={() => act(() => deleteRegion(org.slug, r.id))}>
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
      </Group>
      {(children.get(r.id) ?? []).map((c) => renderNode(c, depth + 1))}
    </Stack>
  );

  return (
    <Container size='md' py='md'>
      <Stack gap='md'>
        <div>
          <Title order={2}>Regions</Title>
          <Text c='dimmed'>
            Areas where your group works (e.g. a state with its study sites). Uploads and turtles are assigned to a
            region, and matching searches the selected region first.
          </Text>
        </div>

        <Paper withBorder p='md' radius='md'>
          <Group align='flex-end'>
            <TextInput label='New region' placeholder='e.g. Kansas or Lawrence' value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
            <Select label='Inside of (optional)' placeholder='Top level' data={regionOptions(regions)} value={parent} onChange={setParent} clearable searchable w={240} />
            <Button leftSection={<IconPlus size={14} />} disabled={!name.trim()} loading={busy} onClick={add} data-testid='org-add-region'>
              Add
            </Button>
          </Group>
        </Paper>

        <Paper withBorder p='md' radius='md'>
          {regions.length === 0 ? (
            <Text c='dimmed'>No regions yet.</Text>
          ) : (
            <Stack gap={6}>{(children.get(null) ?? []).map((r) => renderNode(r, 0))}</Stack>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
