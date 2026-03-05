/**
 * Single form field with optional lock/unlock (add-only mode) and text, textarea, or select input.
 * On mobile we use native <select> to avoid Mantine Select dropdown freezes (portal/scroll-lock).
 */

import { TextInput, Textarea, Select, NativeSelect, Group, Button, Tooltip, ActionIcon, Box } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconLockOpen, IconHelp } from '@tabler/icons-react';
import type { TurtleSheetsData } from '../services/api';

const MOBILE_BREAKPOINT = '(max-width: 768px)';

export type TurtleFormFieldType = 'text' | 'select' | 'textarea';

export interface TurtleFormFieldProps {
  field: keyof TurtleSheetsData;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  /** Optional help content shown in a "?" tooltip next to the label. */
  infoTooltip?: string;
  type?: TurtleFormFieldType;
  selectData?: string[] | { value: string; label: string }[];
  isFieldModeRestricted: boolean;
  isFieldUnlocked: (field: keyof TurtleSheetsData) => boolean;
  requestUnlock: (field: keyof TurtleSheetsData) => void;
  disabled?: boolean;
  error?: string;
}

function LabelWithOptionalTooltip({ label, infoTooltip }: { label: string; infoTooltip?: string }) {
  if (!infoTooltip) return <>{label}</>;
  return (
    <Group gap={4} display='inline-flex'>
      <span>{label}</span>
      <Tooltip
        label={
          <Box component='span' style={{ whiteSpace: 'pre-line' }}>
            {infoTooltip}
          </Box>
        }
        multiline
        maw={320}
        withArrow
      >
        <ActionIcon size='xs' variant='subtle' color='gray' aria-label='Health assessment help'>
          <IconHelp size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function TurtleFormField({
  field,
  label,
  placeholder,
  value,
  onChange,
  description,
  infoTooltip,
  type = 'text',
  selectData = [],
  isFieldModeRestricted,
  isFieldUnlocked,
  requestUnlock,
  disabled,
  error,
}: TurtleFormFieldProps) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const locked = isFieldModeRestricted && !isFieldUnlocked(field);
  const labelNode = <LabelWithOptionalTooltip label={label} infoTooltip={infoTooltip} />;

  if (locked) {
    return (
      <>
        <Group gap='xs' mb={4}>
          <Button
            variant='subtle'
            size='compact-xs'
            leftSection={<IconLockOpen size={14} />}
            onClick={() => requestUnlock(field)}
          >
            Unlock editing
          </Button>
        </Group>
        <TextInput
          label={labelNode}
          value={value}
          disabled
          description={description}
          error={error}
        />
      </>
    );
  }

  if (type === 'select') {
    const data = Array.isArray(selectData) && typeof selectData[0] === 'string'
      ? (selectData as string[]).map((v) => ({ value: v, label: v }))
      : (selectData as { value: string; label: string }[]);

    if (isMobile) {
      const nativeData = placeholder
        ? [{ value: '', label: placeholder }, ...data]
        : data;
      return (
        <NativeSelect
          label={labelNode}
          description={description}
          error={error}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          data={nativeData}
        />
      );
    }

    return (
      <Select
        label={labelNode}
        placeholder={placeholder}
        data={data}
        value={value}
        onChange={(v) => onChange(v || '')}
        description={description}
        disabled={disabled}
        error={error}
        comboboxProps={{ keepMounted: true }}
      />
    );
  }

  if (type === 'textarea') {
    return (
      <Textarea
        label={labelNode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        description={description}
        disabled={disabled}
        error={error}
        minRows={3}
      />
    );
  }

  return (
    <TextInput
      label={labelNode}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      description={description}
      disabled={disabled}
      error={error}
    />
  );
}
