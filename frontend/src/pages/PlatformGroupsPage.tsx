import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Radio,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck, IconPlus } from '@tabler/icons-react';
import { useActiveOrg } from '../hooks/useActiveOrg';
import { useUser } from '../hooks/useUser';
import { useAppDispatch } from '../store/hooks';
import { refreshMyOrgs } from '../store/orgActions';
import { MAIN_ORG_SLUG, setActiveOrg } from '../store/slices/orgSlice';
import { createOrg, listAllOrgs, type Organization } from '../services/api/orgs';
import { formatLocalDate as formatDate } from '../utils/formatLocalDate';
import { RolesExplainer } from '../components/org/RolesExplainer';
import { SuperAdminsPanel } from '../components/org/SuperAdminsPanel';
import { DeleteGroupModal } from '../components/org/DeleteGroupModal';
import { TurtleColumnsEditor } from '../components/org/TurtleColumnsEditor';
import {
  getTurtleColumns,
  setTurtleColumns,
  type StandardColumn,
  type TurtleColumnsInput,
} from '../services/api/turtleColumns';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Super admin: create research groups and assign their first admin. */
export default function PlatformGroupsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { authChecked } = useUser();
  const { active, isSuperAdmin, loaded, select } = useActiveOrg();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [acceptsCommunity, setAcceptsCommunity] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Organization | null>(null);
  // Data fields of the new group: every standard field (default) or a custom choice
  const [fieldsMode, setFieldsMode] = useState<'all' | 'custom'>('all');
  const [templateColumns, setTemplateColumns] = useState<StandardColumn[] | null>(null);
  const [fields, setFields] = useState<TurtleColumnsInput>({ standard: [], custom: [] });

  const load = useCallback(() => {
    listAllOrgs().then(setOrgs).catch(() => setOrgs([]));
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  useEffect(() => {
    if (fieldsMode !== 'custom' || templateColumns) return;
    getTurtleColumns()
      .then((res) => {
        setTemplateColumns(res.standard);
        setFields({ standard: res.standard.map((c) => c.key), custom: [] });
      })
      .catch((e: Error) => {
        notifications.show({ color: 'red', title: 'Could not load the fields', message: e.message });
        setFieldsMode('all');
      });
  }, [fieldsMode, templateColumns]);

  if (!authChecked || !loaded) {
    return (
      <Center py='xl'>
        <Loader />
      </Center>
    );
  }
  if (!isSuperAdmin) {
    return (
      <Container size='sm' py='xl'>
        <Alert color='orange' icon={<IconAlertCircle size={18} />}>
          Only platform super admins can manage research groups.
        </Alert>
      </Container>
    );
  }

  const create = async () => {
    setBusy(true);
    try {
      const res = await createOrg({
        name: name.trim(),
        slug: slug.trim(),
        admin_email: adminEmail.trim() || undefined,
        accepts_community: acceptsCommunity,
      });
      let fieldsError: string | null = null;
      if (fieldsMode === 'custom') {
        try {
          await setTurtleColumns(fields, res.org.slug);
        } catch (e) {
          fieldsError = (e as Error).message;
        }
      }
      if (fieldsError) {
        notifications.show({
          color: 'orange',
          title: 'Data fields not saved',
          message: `${fieldsError} The group uses every field for now; its admins can change this on the members page.`,
        });
      }
      notifications.show({
        color: 'green',
        icon: <IconCheck size={18} />,
        title: 'Research group created',
        message: res.admin
          ? res.admin.status === 'added'
            ? `${res.admin.email} is now its admin.`
            : `An invitation was sent to ${res.admin.email}.`
          : 'Add an admin from the members page.',
      });
      setName('');
      setSlug('');
      setSlugTouched(false);
      setAdminEmail('');
      setFieldsMode('all');
      load();
      refreshMyOrgs(dispatch);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not create group', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onDeleted = (org: Organization) => {
    setDeleting(null);
    if (active.slug === org.slug) select(MAIN_ORG_SLUG);
    notifications.show({
      color: 'green',
      icon: <IconCheck size={18} />,
      title: 'Research group deleted',
      message: `${org.name} and its data were removed.`,
    });
    load();
    refreshMyOrgs(dispatch);
  };

  return (
    <Container size='lg' py='md'>
      <Stack gap='md'>
        <div>
          <Title order={2}>Research Groups</Title>
          <Text c='dimmed'>
            Each group has its own turtles, regions, members and community uploads. New groups work with carapace
            photos and store their data in the PicTur database.
          </Text>
        </div>

        <Paper withBorder p='md' radius='md'>
          <Stack gap='sm'>
            <Text fw={500}>New research group</Text>
            <Group grow align='flex-start'>
              <TextInput
                label='Name'
                placeholder='e.g. Ohio Box Turtle Project'
                value={name}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setName(v);
                  if (!slugTouched) setSlug(slugify(v));
                }}
              />
              <TextInput
                label='URL name'
                description={slug ? `/g/${slug}` : 'lowercase letters, digits, dashes'}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.currentTarget.value.toLowerCase());
                }}
              />
            </Group>
            <TextInput
              label='First admin (email, optional)'
              description='Existing accounts become admin right away; otherwise an invitation is emailed.'
              type='email'
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.currentTarget.value)}
            />
            <Switch
              label='Accept photos from the community'
              checked={acceptsCommunity}
              onChange={(e) => setAcceptsCommunity(e.currentTarget.checked)}
            />
            <Radio.Group
              label='Turtle data fields'
              description='What the group records about each turtle. Its admins can change this later.'
              value={fieldsMode}
              onChange={(v) => setFieldsMode(v as 'all' | 'custom')}
            >
              <Stack gap={6} mt='xs'>
                <Radio value='all' label='All fields of the original PicTur group' data-testid='fields-mode-all' />
                <Radio value='custom' label='Choose fields and add our own' data-testid='fields-mode-custom' />
              </Stack>
            </Radio.Group>
            {fieldsMode === 'custom' &&
              (templateColumns ? (
                <Paper withBorder p='sm' radius='md'>
                  <TurtleColumnsEditor standard={templateColumns} value={fields} onChange={setFields} disabled={busy} />
                </Paper>
              ) : (
                <Loader size='sm' />
              ))}
            <Group justify='flex-end'>
              <Button leftSection={<IconPlus size={14} />} disabled={!name.trim() || !slug.trim()} loading={busy} onClick={create} data-testid='platform-create-group'>
                Create group
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder radius='md'>
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing='xs'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Group</Table.Th>
                  <Table.Th>Storage</Table.Th>
                  <Table.Th>Members</Table.Th>
                  <Table.Th>Community</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {orgs === null && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Center py='md'>
                        <Loader size='sm' />
                      </Center>
                    </Table.Td>
                  </Table.Tr>
                )}
                {orgs?.map((o) => (
                  <Table.Tr key={o.id}>
                    <Table.Td>
                      <Text size='sm' fw={500}>{o.name}</Text>
                      <Text size='xs' c='dimmed'>{o.slug}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size='sm' variant='light' color={o.kind === 'sheets' ? 'grape' : 'teal'}>
                        {o.kind === 'sheets' ? 'Google Sheets' : 'Database'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{o.member_count ?? '–'}</Table.Td>
                    <Table.Td>{o.accepts_community ? 'yes' : 'no'}</Table.Td>
                    <Table.Td>{formatDate(o.created_at)}</Table.Td>
                    <Table.Td>
                      <Anchor
                        component='button'
                        size='sm'
                        onClick={() => {
                          dispatch(setActiveOrg(o.slug));
                          navigate(o.kind === 'db' ? '/admin/users' : '/');
                        }}
                      >
                        Open
                      </Anchor>
                      {o.kind === 'db' && (
                        <Anchor
                          component='button'
                          size='sm'
                          c='red'
                          ml='md'
                          onClick={() => setDeleting(o)}
                          data-testid={`platform-delete-group-${o.slug}`}
                        >
                          Delete
                        </Anchor>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>

        <div>
          <Title order={3} mt='md'>
            Roles
          </Title>
          <Text c='dimmed' size='sm'>
            Who may do what. Admins and staff belong to one research group; super admins are above all groups.
          </Text>
        </div>
        <RolesExplainer />
        <SuperAdminsPanel />
      </Stack>
      <DeleteGroupModal org={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} />
    </Container>
  );
}
