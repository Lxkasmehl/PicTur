import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface ScopeAlertProps {
  /** Override the default read-only explanation. */
  message?: string;
  /** Override the default title. */
  title?: string;
}

const DEFAULT_TITLE = 'Read-only — outside your assigned areas';
const DEFAULT_MESSAGE =
  'These results include turtles outside your assigned areas, so this view is read-only. Saves and approvals are disabled.';

/**
 * Warning banner shown wherever a scoped (Sub-Area) staff member is looking at a
 * result set the backend flagged as scope-expanded (`scope_expanded` / a candidate
 * `in_scope: false`). Shared by the match page, the review queue, and the carapace
 * quick check. Purely UX — the server enforces scope independently (403s on write).
 */
export function ScopeAlert({ message, title }: ScopeAlertProps) {
  return (
    <Alert
      icon={<IconAlertTriangle size={18} />}
      color="yellow"
      variant="light"
      radius="md"
      title={title ?? DEFAULT_TITLE}
      data-testid="scope-alert"
    >
      {message ?? DEFAULT_MESSAGE}
    </Alert>
  );
}
