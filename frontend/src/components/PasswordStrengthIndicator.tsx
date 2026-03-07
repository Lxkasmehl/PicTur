import { Progress, Stack, Text, Group, Box } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import {
  getPasswordRequirements,
  getPasswordStrengthLevel,
  getPasswordStrengthLabel,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../utils/passwordStrength';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const strengthColors: Record<string, string> = {
  weak: 'red',
  fair: 'orange',
  good: 'yellow',
  strong: 'green',
};

export function PasswordStrengthIndicator({
  password,
}: PasswordStrengthIndicatorProps): React.JSX.Element {
  const requirements = getPasswordRequirements(password);
  const level = getPasswordStrengthLevel(password);
  const label = getPasswordStrengthLabel(password);
  const progressPercent = level * 25; // 0, 25, 50, 75, 100
  const color = strengthColors[label] ?? 'gray';

  if (!password.length) {
    return (
      <Box mt="xs">
        <Text size="xs" c="dimmed" mb={4}>
          Password requirements
        </Text>
        <Stack gap={4}>
          {[
            { key: 'length', text: `At least ${PASSWORD_MIN_LENGTH} characters (max ${PASSWORD_MAX_LENGTH})` },
            { key: 'upper', text: 'One uppercase letter' },
            { key: 'lower', text: 'One lowercase letter' },
            { key: 'digit', text: 'One number' },
            { key: 'special', text: 'One special character (!@#$%^&* …)' },
          ].map(({ key, text }) => (
            <Group key={key} gap={6} wrap="nowrap">
              <IconX size={14} style={{ color: 'var(--mantine-color-gray-4)', flexShrink: 0 }} />
              <Text size="xs" c="dimmed">
                {text}
              </Text>
            </Group>
          ))}
        </Stack>
        <Text size="xs" c="dimmed" mt={6}>
          Avoid common passwords like &quot;password123&quot;.
        </Text>
      </Box>
    );
  }

  return (
    <Box mt="xs">
      <Group justify="space-between" mb={4}>
        <Text size="xs" c="dimmed">
          Password strength
        </Text>
        <Text size="xs" fw={600} c={color}>
          {label === 'weak' && 'Weak'}
          {label === 'fair' && 'Fair'}
          {label === 'good' && 'Good'}
          {label === 'strong' && 'Strong'}
        </Text>
      </Group>
      <Progress
        value={progressPercent}
        color={color}
        size="sm"
        radius="xl"
        mb="sm"
      />
      <Stack gap={4}>
        <RequirementRow
          met={requirements.length && requirements.lengthValid}
          invalid={password.length > PASSWORD_MAX_LENGTH}
          text={
            requirements.lengthValid
              ? `At least ${PASSWORD_MIN_LENGTH} characters`
              : `Maximum ${PASSWORD_MAX_LENGTH} characters`
          }
        />
        <RequirementRow met={requirements.upper} text="One uppercase letter" />
        <RequirementRow met={requirements.lower} text="One lowercase letter" />
        <RequirementRow met={requirements.digit} text="One number" />
        <RequirementRow met={requirements.special} text="One special character (!@#$%^&* …)" />
      </Stack>
      {requirements.length && requirements.upper && requirements.lower && requirements.digit && requirements.special && (
        <Text size="xs" c="dimmed" mt={6}>
          Avoid common passwords — the server will reject them.
        </Text>
      )}
    </Box>
  );
}

function RequirementRow({
  met,
  invalid,
  text,
}: {
  met: boolean;
  invalid?: boolean;
  text: string;
}): React.JSX.Element {
  return (
    <Group gap={6} wrap="nowrap">
      {met ? (
        <IconCheck size={14} style={{ color: 'var(--mantine-color-green-6)', flexShrink: 0 }} />
      ) : (
        <IconX
          size={14}
          style={{
            color: invalid ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-gray-4)',
            flexShrink: 0,
          }}
        />
      )}
      <Text size="xs" c={met ? 'green' : invalid ? 'red' : 'dimmed'}>
        {text}
      </Text>
    </Group>
  );
}
