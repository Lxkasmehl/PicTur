import { useEffect, useState } from 'react';
import { Alert, Button, Group, List, Loader, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { deleteOrg, getOrgUsage, type Organization, type OrgUsage } from '../../services/api/orgs';

interface DeleteGroupModalProps {
  org: Organization | null;
  onClose: () => void;
  onDeleted: (org: Organization) => void;
}

/**
 * Super admin: delete a research group. An empty group needs its URL name typed; a group that
 * still holds data also needs its full name, and the dialog lists what would be lost.
 */
export function DeleteGroupModal({ org, onClose, onDeleted }: DeleteGroupModalProps) {
  const [usage, setUsage] = useState<OrgUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slugInput, setSlugInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsage(null);
    setLoadError(null);
    setSlugInput('');
    setNameInput('');
    setError(null);
    if (!org) return;
    let cancelled = false;
    getOrgUsage(org.slug)
      .then((u) => !cancelled && setUsage(u))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [org]);

  if (!org) return null;

  const slugOk = slugInput.trim().toLowerCase() === org.slug.toLowerCase();
  const nameOk = !usage?.has_data || nameInput.trim() === org.name.trim();
  const canDelete = usage !== null && slugOk && nameOk && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteOrg(org.slug, usage?.has_data ? nameInput.trim() : undefined);
      onDeleted(org);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const usageItems = usage
    ? ([
        [usage.turtle_records, 'turtle records'],
        [usage.community_records, 'community records'],
        [usage.review_queue, 'uploads in the review queue'],
        [usage.photos, 'photos'],
      ] as const).filter(([n]) => n > 0)
    : [];

  return (
    <Modal opened onClose={onClose} title={`Delete ${org.name}?`} centered>
      <Stack gap='sm'>
        {!usage && !loadError && (
          <Group gap='xs'>
            <Loader size='xs' />
            <Text size='sm'>Checking what this group holds…</Text>
          </Group>
        )}
        {loadError && <Alert color='red'>{loadError}</Alert>}
        {usage && !usage.has_data && (
          <Text size='sm'>
            This group holds no turtles, records or photos. Its members, invitations and settings will be removed.
          </Text>
        )}
        {usage?.has_data && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} title='This group still holds data'>
            <Stack gap={4}>
              <List size='sm'>
                {usageItems.map(([n, label]) => (
                  <List.Item key={label}>
                    {n} {label}
                  </List.Item>
                ))}
              </List>
              <Text size='sm'>
                All of it is deleted permanently together with the members and settings. This cannot be undone.
              </Text>
            </Stack>
          </Alert>
        )}
        {usage && (
          <>
            <TextInput
              label={`Type the URL name "${org.slug}" to confirm`}
              value={slugInput}
              onChange={(e) => setSlugInput(e.currentTarget.value)}
              data-testid='delete-group-confirm-slug'
              autoComplete='off'
            />
            {usage.has_data && (
              <TextInput
                label={`Type the full name "${org.name}" to delete its data`}
                value={nameInput}
                onChange={(e) => setNameInput(e.currentTarget.value)}
                data-testid='delete-group-confirm-name'
                autoComplete='off'
              />
            )}
          </>
        )}
        {error && <Alert color='red'>{error}</Alert>}
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            color='red'
            leftSection={<IconTrash size={14} />}
            disabled={!canDelete}
            loading={busy}
            onClick={submit}
            data-testid='delete-group-submit'
          >
            Delete group
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
