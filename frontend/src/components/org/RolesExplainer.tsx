import { Badge, Group, List, Paper, SimpleGrid, Stack, Text } from '@mantine/core';

const ROLES = [
  {
    name: 'Super admin',
    color: 'grape',
    scope: 'The whole platform — every research group',
    can: [
      'Creates research groups and names their first admin',
      'Acts as admin in every group, including PicTur Research (the main group)',
      'Promotes and removes other super admins (this page)',
    ],
    note: 'Not a member of a group by itself. Give it only to people who run the platform.',
  },
  {
    name: 'Admin',
    color: 'red',
    scope: 'One research group',
    can: [
      'Everything staff can do in that group',
      'User Management: invites members, changes their role (staff / admin), removes them',
      'Locations: sets up programs, areas and General Locations',
      "Downloads backups of the group's data",
    ],
    note: 'Has no rights in other groups unless they are a member there too.',
  },
  {
    name: 'Staff',
    color: 'orange',
    scope: 'One research group',
    can: [
      'Uploads photos and confirms matches',
      'Works through the review queue and community uploads',
      'Edits turtle records and releases turtles',
    ],
    note: 'Cannot manage members or locations.',
  },
] as const;

/** What super admin, admin and staff may do (shown where super admins hand out rights). */
export function RolesExplainer() {
  return (
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing='sm'>
      {ROLES.map((role) => (
        <Paper key={role.name} withBorder radius='md' p='sm'>
          <Stack gap={6}>
            <Group gap='xs'>
              <Badge color={role.color} variant='light'>
                {role.name}
              </Badge>
            </Group>
            <Text size='xs' c='dimmed'>
              {role.scope}
            </Text>
            <List size='sm' spacing={2}>
              {role.can.map((item) => (
                <List.Item key={item}>{item}</List.Item>
              ))}
            </List>
            <Text size='xs' c='dimmed'>
              {role.note}
            </Text>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
