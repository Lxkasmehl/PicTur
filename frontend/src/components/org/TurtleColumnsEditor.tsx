import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { TURTLE_SHEETS_FORM_FIELDS } from '../turtleSheetsDataFormFieldsConfig';
import type { CustomColumn, CustomColumnType, StandardColumn, TurtleColumnsInput } from '../../services/api/turtleColumns';

const FORM_LABEL: Record<string, string> = Object.fromEntries(TURTLE_SHEETS_FORM_FIELDS.map((f) => [f.key, f.label]));

const CATEGORIES: { title: string; keys: string[] }[] = [
  { title: 'Identification', keys: ['primary_id', 'id', 'name', 'species', 'sex', 'pit'] },
  { title: 'Finds and dates', keys: ['date_1st_found', 'dates_refound', 'last_assay_date', 'dna_extracted'] },
  { title: 'Location', keys: ['general_location', 'location', 'specific_location'] },
  { title: 'Health', keys: ['health_status', 'deceased', 'cow_interactions', 'flesh_flies', 'notes'] },
  {
    title: 'Archive and tags',
    keys: ['plastron_picture_in_archive', 'carapace_picture_in_archive', 'adopted', 'ibutton', 'ibutton_last_set'],
  },
  {
    title: 'Transmitter',
    keys: [
      'freq',
      'transmitter_put_on_by',
      'transmitter_on_date',
      'transmitter_type',
      'transmitter_lifespan',
      'radio_replace_date',
      'old_frequencies',
    ],
  },
];

const REQUIRED_REASON: Record<string, string> = {
  primary_id: 'Identifies every turtle',
  id: 'The biology ID (e.g. F001) is generated from Sex',
  sex: 'Needed to generate the biology ID',
  general_location: 'Follows your location setup on the Locations page',
};

const TYPE_OPTIONS: { value: CustomColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'yesno', label: 'Yes / No' },
  { value: 'select', label: 'Choice list' },
  { value: 'textarea', label: 'Long text' },
];

interface TurtleColumnsEditorProps {
  /** Standard columns with their required flags (from GET /api/turtle-columns). */
  standard: StandardColumn[];
  value: TurtleColumnsInput;
  onChange: (value: TurtleColumnsInput) => void;
  disabled?: boolean;
}

/**
 * Pick the standard turtle data fields a research group uses (the original PicTur group's
 * spreadsheet is the template) and define the group's own fields.
 */
export function TurtleColumnsEditor({ standard, value, onChange, disabled = false }: TurtleColumnsEditorProps) {
  const byKey = new Map(standard.map((c) => [c.key, c]));
  const chosen = new Set(value.standard);
  const categorized = new Set(CATEGORIES.flatMap((c) => c.keys));
  const categories = [
    ...CATEGORIES,
    { title: 'Measurements and other', keys: standard.map((c) => c.key).filter((k) => !categorized.has(k)) },
  ];
  const requiredKeys = standard.filter((c) => c.required).map((c) => c.key);

  const setStandard = (keys: Iterable<string>) => {
    const set = new Set([...keys, ...requiredKeys]);
    onChange({ ...value, standard: standard.map((c) => c.key).filter((k) => set.has(k)) });
  };
  const toggle = (key: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    setStandard(next);
  };
  const setCustom = (custom: CustomColumn[]) => onChange({ ...value, custom });
  const updateCustom = (i: number, patch: Partial<CustomColumn>) =>
    setCustom(value.custom.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Stack gap='md'>
      <Group gap='xs'>
        <Text size='sm' c='dimmed'>
          Start from:
        </Text>
        <Button size='compact-xs' variant='light' disabled={disabled} onClick={() => setStandard(standard.map((c) => c.key))}>
          All fields of the original PicTur group
        </Button>
        <Button size='compact-xs' variant='light' disabled={disabled} onClick={() => setStandard([])}>
          Only the required fields
        </Button>
        <Badge variant='light' color='gray'>
          {value.standard.length} of {standard.length} selected
        </Badge>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing='md'>
        {categories.map((cat) => {
          const cols = cat.keys.map((k) => byKey.get(k)).filter((c): c is StandardColumn => Boolean(c));
          if (cols.length === 0) return null;
          return (
            <Stack key={cat.title} gap={6}>
              <Text size='sm' fw={600}>
                {cat.title}
              </Text>
              {cols.map((c) => {
                const label = c.key === 'primary_id' ? 'Primary ID' : FORM_LABEL[c.key] ?? c.header;
                const box = (
                  <Checkbox
                    key={c.key}
                    size='xs'
                    label={label}
                    checked={c.required || chosen.has(c.key)}
                    disabled={disabled || c.required}
                    onChange={(e) => toggle(c.key, e.currentTarget.checked)}
                    data-testid={`turtle-column-${c.key}`}
                  />
                );
                return c.required ? (
                  <Tooltip key={c.key} label={`Always included: ${REQUIRED_REASON[c.key] ?? 'required'}`} position='top-start'>
                    <div>{box}</div>
                  </Tooltip>
                ) : (
                  box
                );
              })}
            </Stack>
          );
        })}
      </SimpleGrid>

      <Stack gap='xs'>
        <Text size='sm' fw={600}>
          Your own fields
        </Text>
        {value.custom.length === 0 && (
          <Text size='sm' c='dimmed'>
            Need something the original group does not record? Add your own field.
          </Text>
        )}
        {value.custom.map((col, i) => (
          <Group key={col.key ?? `new-${i}`} align='flex-start' gap='xs' wrap='nowrap'>
            <TextInput
              aria-label='Field name'
              placeholder='Field name, e.g. Eye color'
              value={col.label}
              disabled={disabled}
              onChange={(e) => updateCustom(i, { label: e.currentTarget.value })}
              style={{ flex: 2 }}
              data-testid={`custom-column-label-${i}`}
            />
            <Select
              aria-label='Field type'
              data={TYPE_OPTIONS}
              value={col.type}
              allowDeselect={false}
              disabled={disabled}
              onChange={(v) => updateCustom(i, { type: (v || 'text') as CustomColumnType })}
              style={{ flex: 1 }}
              comboboxProps={{ withinPortal: true, zIndex: 1100 }}
            />
            {col.type === 'select' && (
              <TagsInput
                aria-label='Choices'
                placeholder='Choices (press Enter)'
                value={col.options ?? []}
                disabled={disabled}
                onChange={(options) => updateCustom(i, { options })}
                style={{ flex: 2 }}
              />
            )}
            <ActionIcon
              variant='subtle'
              color='red'
              aria-label='Remove field'
              disabled={disabled}
              onClick={() => setCustom(value.custom.filter((_, j) => j !== i))}
              mt={4}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        <Group>
          <Button
            size='xs'
            variant='light'
            leftSection={<IconPlus size={14} />}
            disabled={disabled}
            onClick={() => setCustom([...value.custom, { label: '', type: 'text' }])}
            data-testid='custom-column-add'
          >
            Add field
          </Button>
        </Group>
        <Text size='xs' c='dimmed'>
          Turning a field off only hides it. Values already recorded are kept and come back when you turn it on again.
        </Text>
      </Stack>
    </Stack>
  );
}
