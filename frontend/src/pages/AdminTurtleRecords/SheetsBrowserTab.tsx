import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Grid,
  Group,
  Image,
  Menu,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDatabase, IconDownload, IconMapPin, IconPhoto, IconSearch, IconSkull } from '@tabler/icons-react';
import {
  downloadAdminBackupArchive,
  getImageUrl,
  getTurtleImages,
  getTurtlePrimariesBatch,
  isAdminRole,
  type TurtleImagesResponse,
} from '../../services/api';
import { useUser } from '../../hooks/useUser';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';

function turtleKey(turtle: { primary_id?: string | null; id?: string | null; sheet_name?: string | null }) {
  const id = turtle.primary_id || turtle.id || '';
  const sheet = turtle.sheet_name ?? '';
  return `${id}|${sheet}`;
}

function isSheetsDeceasedYes(v?: string | null): boolean {
  const s = (v || '').trim().toLowerCase();
  return ['yes', 'y', 'true', '1', 'deceased', 'dead'].includes(s);
}

export function SheetsBrowserTab() {
  const { role } = useUser();
  const ctx = useAdminTurtleRecordsContext();
  const [turtleImages, setTurtleImages] = useState<TurtleImagesResponse | null>(null);
  const [primaryImages, setPrimaryImages] = useState<Record<string, string | null>>({});
  const [backupLoading, setBackupLoading] = useState(false);
  const {
    selectedSheetFilter,
    sheetsListLoading,
    availableSheets,
    searchQuery,
    setSearchQuery,
    loadAllTurtles,
    turtlesLoading,
    filteredTurtles,
    allTurtles,
    selectedTurtle,
    setSelectedTurtle,
    handleSaveTurtleFromBrowser: onSaveTurtle,
    setSelectedSheetFilterAndLoad: onSheetFilterChange,
  } = ctx;

  const turtleId = selectedTurtle?.primary_id || selectedTurtle?.id;
  const sheetName = selectedTurtle?.sheet_name ?? null;

  useEffect(() => {
    if (!turtleId) {
      setTurtleImages(null);
      return;
    }
    getTurtleImages(turtleId, sheetName)
      .then(setTurtleImages)
      .catch(() => setTurtleImages(null));
  }, [turtleId, sheetName]);

  // Load primary (plastron) images for the turtle list so we can show them in cards
  useEffect(() => {
    if (filteredTurtles.length === 0) {
      setPrimaryImages({});
      return;
    }
    const turtles = filteredTurtles.map((t) => ({
      turtle_id: t.primary_id || t.id || '',
      sheet_name: t.sheet_name ?? null,
    })).filter((t) => t.turtle_id);
    if (turtles.length === 0) {
      setPrimaryImages({});
      return;
    }
    getTurtlePrimariesBatch(turtles)
      .then((res) => {
        const map: Record<string, string | null> = {};
        res.images.forEach((img) => {
          const key = `${img.turtle_id}|${img.sheet_name ?? ''}`;
          map[key] = img.primary;
        });
        setPrimaryImages(map);
      })
      .catch(() => setPrimaryImages({}));
  }, [filteredTurtles]);

  // --- NEW LOGIC: Filter for the most recent date folder ---
  const allAdditionalImages = turtleImages?.additional ?? [];
  let latestDate = '';
  const dateRegex = /(\d{4}-\d{2}-\d{2})[/\\]/;

  // 1. Find the highest (most recent) date in the paths
  allAdditionalImages.forEach((img) => {
    const match = img.path.match(dateRegex);
    if (match && match[1] > latestDate) {
      latestDate = match[1];
    }
  });

  // 2. Filter images to only include those from the latest date
  // Fallback to all images if no dates are found (e.g., legacy flat-directory uploads)
  const recentAdditionalImages = latestDate
    ? allAdditionalImages.filter((img) => img.path.includes(latestDate))
    : allAdditionalImages;

  return (
    <Grid gutter='lg'>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Paper shadow='sm' p='md' radius='md' withBorder>
          <Stack gap='md'>
            <Text fw={500} size='lg'>
              Search & Filter
            </Text>
            <Select
              label='Location (Spreadsheet)'
              description={
                sheetsListLoading
                  ? 'Loading locations…'
                  : selectedSheetFilter
                    ? 'Only turtles from this sheet'
                    : 'All sheets'
              }
              placeholder='All locations'
              leftSection={<IconMapPin size={16} />}
              value={selectedSheetFilter}
              onChange={(value) => onSheetFilterChange(value ?? '')}
              data={[
                { value: '', label: 'All locations' },
                ...availableSheets.map((s) => ({ value: s, label: s })),
              ]}
              allowDeselect={false}
              searchable
              clearable={false}
              disabled={sheetsListLoading}
            />
            <TextInput
              placeholder='Search by ID, name, species, location...'
              leftSection={<IconSearch size={16} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button onClick={() => loadAllTurtles()} loading={turtlesLoading} fullWidth>
              Refresh
            </Button>
            {isAdminRole(role) && (
              <>
                <Menu shadow='md' width={320} withinPortal>
                  <Menu.Target>
                    <Button
                      variant='light'
                      color='teal'
                      fullWidth
                      leftSection={<IconDownload size={16} />}
                      loading={backupLoading}
                    >
                      Offline backup (ZIP)
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Server data folder + Google Sheets</Menu.Label>
                    <Menu.Item
                      onClick={async () => {
                        setBackupLoading(true);
                        try {
                          await downloadAdminBackupArchive({ scope: 'all' });
                          notifications.show({
                            title: 'Download started',
                            message: 'Save the ZIP from your browser downloads folder.',
                            color: 'teal',
                          });
                        } catch (e) {
                          notifications.show({
                            title: 'Backup failed',
                            message: e instanceof Error ? e.message : 'Unknown error',
                            color: 'red',
                          });
                        } finally {
                          setBackupLoading(false);
                        }
                      }}
                    >
                      Full archive — entire data directory and all sheet tabs
                    </Menu.Item>
                    <Menu.Item
                      disabled={!selectedSheetFilter}
                      onClick={async () => {
                        const sheet = selectedSheetFilter;
                        if (!sheet) return;
                        setBackupLoading(true);
                        try {
                          await downloadAdminBackupArchive({ scope: 'sheet', sheet });
                          notifications.show({
                            title: 'Download started',
                            message: `Backup for tab "${sheet}" is saving to your downloads folder.`,
                            color: 'teal',
                          });
                        } catch (e) {
                          notifications.show({
                            title: 'Backup failed',
                            message: e instanceof Error ? e.message : 'Unknown error',
                            color: 'red',
                          });
                        } finally {
                          setBackupLoading(false);
                        }
                      }}
                    >
                      Current location tab only
                      {selectedSheetFilter
                        ? ` (${selectedSheetFilter})`
                        : ' — pick a location above'}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                <Text size='xs' c='dimmed'>
                  Admin only. ZIP includes on-disk data and CSV/JSON sheet snapshots for disaster recovery.
                </Text>
              </>
            )}
            <Divider />
            <Text size='sm' c='dimmed'>
              {filteredTurtles.length} of {allTurtles.length} turtles
            </Text>
            <ScrollArea h={600}>
              <Stack gap='xs'>
                {filteredTurtles.map((turtle, index) => (
                  <Card
                    key={`${turtle.primary_id || turtle.id || 'turtle'}-${index}-${turtle.sheet_name || ''}`}
                    shadow='sm'
                    padding='sm'
                    radius='md'
                    withBorder
                    style={{
                      cursor: 'pointer',
                      border:
                        selectedTurtle?.primary_id ===
                        (turtle.primary_id || turtle.id)
                          ? '2px solid #228be6'
                          : '1px solid #dee2e6',
                      backgroundColor:
                        selectedTurtle?.primary_id ===
                        (turtle.primary_id || turtle.id)
                          ? '#e7f5ff'
                          : isSheetsDeceasedYes(turtle.deceased)
                            ? '#f4f4f5'
                            : 'white',
                    }}
                    onClick={() => setSelectedTurtle(turtle)}
                  >
                    <Group justify='space-between' align='flex-start' wrap='nowrap' gap='sm'>
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="wrap">
                          {turtle.name ? (
                            <Text fw={600} size='md' c='blue'>
                              {turtle.name}
                            </Text>
                          ) : null}
                          {isSheetsDeceasedYes(turtle.deceased) && (
                            <Badge size="sm" color="gray" variant="filled" leftSection={<IconSkull size={12} />}>
                              Deceased
                            </Badge>
                          )}
                        </Group>
                        {!turtle.name ? (
                          <Text fw={500} size='sm' c='dimmed' fs='italic'>
                            No name
                          </Text>
                        ) : null}

                        <Stack gap={2}>
                          {turtle.location && (
                            <Text size='sm' fw={500}>
                              📍 {turtle.location}
                            </Text>
                          )}
                          {turtle.species && (
                            <Text size='sm' c='dimmed'>
                              🐢 {turtle.species}
                            </Text>
                          )}
                        </Stack>

                        <Stack gap={2} mt='xs'>
                          {turtle.primary_id && (
                            <Text size='xs' c='dimmed'>
                              Primary ID: <strong>{turtle.primary_id}</strong>
                            </Text>
                          )}
                          {turtle.id && turtle.id !== turtle.primary_id && (
                            <Text size='xs' c='dimmed'>
                              ID: {turtle.id}
                            </Text>
                          )}
                          {!turtle.primary_id && !turtle.id && (
                            <Text size='xs' c='red' fs='italic'>
                              No ID
                            </Text>
                          )}
                        </Stack>
                      </Stack>
                      <Box
                        style={{
                          width: 112,
                          flexShrink: 0,
                          borderRadius: 6,
                          overflow: 'hidden',
                          backgroundColor: 'var(--mantine-color-gray-1)',
                          minHeight: 84,
                        }}
                      >
                        {primaryImages[turtleKey(turtle)] ? (
                          <Image
                            src={getImageUrl(primaryImages[turtleKey(turtle)]!)}
                            alt='Plastron'
                            fit='contain'
                            style={{ width: '100%', height: 'auto', display: 'block' }}
                          />
                        ) : (
                          <Center w='100%' h='100%' style={{ minHeight: 84 }}>
                            <IconPhoto size={28} stroke={1.2} style={{ opacity: 0.4 }} />
                          </Center>
                        )}
                      </Box>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 8 }}>
        {selectedTurtle ? (
          <Stack gap='md'>
            {turtleId && (
              <AdditionalImagesSection
                title={`Turtle photos (Microhabitat / Condition)${latestDate ? ` - ${latestDate}` : ''}`}
                images={recentAdditionalImages.map((a) => ({
                  imagePath: a.path,
                  filename: a.path.split(/[/\\]/).pop() ?? a.path,
                  type: a.type,
                }))}
                turtleId={turtleId}
                sheetName={sheetName}
                onRefresh={async () => {
                  if (!turtleId) return;
                  const res = await getTurtleImages(turtleId, sheetName);
                  setTurtleImages(res);
                }}
              />
            )}
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <ScrollArea h={700}>
                <TurtleSheetsDataForm
                  initialData={selectedTurtle}
                  sheetName={selectedTurtle.sheet_name}
                  initialAvailableSheets={
                    availableSheets.length > 0 ? availableSheets : undefined
                  }
                  state={selectedTurtle.general_location || ''}
                  location={selectedTurtle.location || ''}
                  primaryId={
                    selectedTurtle.primary_id || selectedTurtle.id || undefined
                  }
                  mode='edit'
                  onSave={onSaveTurtle}
                />
              </ScrollArea>
            </Paper>
          </Stack>
        ) : (
          <Paper shadow='sm' p='xl' radius='md' withBorder>
            <Center py='xl'>
              <Stack gap='md' align='center'>
                <IconDatabase size={64} stroke={1.5} style={{ opacity: 0.3 }} />
                <Text size='lg' c='dimmed' ta='center'>
                  Select a turtle to edit
                </Text>
                <Text size='sm' c='dimmed' ta='center'>
                  Choose a turtle from the list to view and edit its Google Sheets
                  data
                </Text>
              </Stack>
            </Center>
          </Paper>
        )}
      </Grid.Col>
    </Grid>
  );
}