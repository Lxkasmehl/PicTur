/**
 * BackupCountdownOverlay
 *
 * Three-state UI for the nightly chronodrop:
 *   - idle:        before the 5-minute pre-window — renders nothing.
 *   - countdown:   T-5min … T-0 — bottom-right floating badge with mm:ss.
 *   - maintenance: T-0 … backend health-check returns ok — full-screen
 *                  modal blocking interaction. Polls /api/health every 5s.
 *
 * Mounted once at the App level; gated to staff/admin only.
 *
 * The window's absolute timestamp comes from /api/backup/window so client
 * clock drift / timezone issues do not skew the countdown — the server
 * is the source of truth.
 */

import { useEffect, useRef, useState } from 'react';
import { Affix, Modal, Stack, Text, Title, Group, Loader } from '@mantine/core';
import { IconCloudUpload } from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { isStaffRole } from '../services/api/auth';
import { getBackupWindow, type BackupWindow } from '../services/api/backup';
import { TURTLE_API_BASE_URL } from '../services/api/config';

const COUNTDOWN_LEAD_SECONDS = 5 * 60;
const IDLE_POLL_MS = 60_000;
const MAINTENANCE_POLL_MS = 5_000;
const STALE_AFTER_MS = 10 * 60 * 1000;

type Phase = 'idle' | 'countdown' | 'maintenance';

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function backendIsHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${TURTLE_API_BASE_URL.replace(/\/api$/, '')}/api/health`, {
      method: 'GET',
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function BackupCountdownOverlay() {
  const { role, isLoggedIn } = useUser();
  const [windowInfo, setWindowInfo] = useState<BackupWindow | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [phase, setPhase] = useState<Phase>('idle');
  const maintenanceStartedAt = useRef<number | null>(null);

  const isAdminPage = role && isStaffRole(role);

  // Refetch the window whenever we drop back to idle (e.g. after a maintenance
  // window completes — fresh next_start_unix for tomorrow).
  useEffect(() => {
    if (!isAdminPage || !isLoggedIn) {
      setWindowInfo(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      getBackupWindow()
        .then((w) => {
          if (!cancelled) setWindowInfo(w);
        })
        .catch(() => {
          /* ignore — overlay is not critical; will retry next tick */
        });
    };
    load();
    const id = window.setInterval(load, IDLE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAdminPage, isLoggedIn]);

  // Tick the local clock every second when in countdown or maintenance,
  // every 30s otherwise (cheap; just keeps phase transitions fresh).
  useEffect(() => {
    if (!windowInfo) return;
    const tickMs = phase === 'idle' ? 30_000 : 1_000;
    const id = window.setInterval(() => setNow(Date.now() / 1000), tickMs);
    return () => window.clearInterval(id);
  }, [windowInfo, phase]);

  // Phase derivation.
  useEffect(() => {
    if (!windowInfo) {
      setPhase('idle');
      return;
    }
    const start = windowInfo.next_start_unix;
    if (now < start - COUNTDOWN_LEAD_SECONDS) {
      setPhase('idle');
    } else if (now < start) {
      setPhase('countdown');
    } else {
      setPhase('maintenance');
      if (maintenanceStartedAt.current === null) {
        maintenanceStartedAt.current = Date.now();
      }
    }
  }, [now, windowInfo]);

  // Maintenance recovery: poll /api/health, dismiss when healthy AND we're
  // past the expected duration (avoids flapping while backend restarts).
  useEffect(() => {
    if (phase !== 'maintenance' || !windowInfo) return;
    const expectedEnd = windowInfo.next_start_unix + windowInfo.duration_seconds;
    let cancelled = false;
    const id = window.setInterval(async () => {
      if (cancelled) return;
      const ok = await backendIsHealthy();
      const past = Date.now() / 1000 > expectedEnd;
      if (ok && past) {
        // Refetch to get tomorrow's window; phase will fall back to idle.
        try {
          const fresh = await getBackupWindow();
          if (!cancelled) {
            setWindowInfo(fresh);
            maintenanceStartedAt.current = null;
          }
        } catch {
          /* keep modal up; will retry */
        }
      }
    }, MAINTENANCE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, windowInfo]);

  if (!isAdminPage || !isLoggedIn || !windowInfo) return null;

  const remaining = Math.max(0, Math.round(windowInfo.next_start_unix - now));

  if (phase === 'countdown') {
    return (
      <Affix position={{ bottom: 24, right: 24 }} zIndex={9999}>
        <Group
          gap="sm"
          p="sm"
          wrap="nowrap"
          style={{
            background: 'var(--mantine-color-orange-6)',
            color: 'white',
            borderRadius: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            maxWidth: 360,
          }}
        >
          <IconCloudUpload size={28} stroke={1.7} />
          <Stack gap={2}>
            <Text fw={700} size="sm">
              Server backup in {formatRemaining(remaining)}
            </Text>
            <Text size="xs" style={{ opacity: 0.92 }}>
              Please save your work — admin pages will pause briefly while the backup runs.
            </Text>
          </Stack>
        </Group>
      </Affix>
    );
  }

  if (phase === 'maintenance') {
    const stale =
      maintenanceStartedAt.current !== null &&
      Date.now() - maintenanceStartedAt.current > STALE_AFTER_MS;
    return (
      <Modal
        opened
        onClose={() => {
          /* unclosable while in maintenance */
        }}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        size="md"
        title="Server backup in progress"
        zIndex={9999}
      >
        <Stack gap="md" align="center" py="md">
          <Loader size="lg" />
          <Title order={4} ta="center">
            Nightly backup is running
          </Title>
          <Text ta="center" size="sm" c="dimmed">
            The system will resume automatically when the backup finishes
            and the server has fully restarted. You will not lose any saved
            work.
          </Text>
          {stale && (
            <Text ta="center" size="xs" c="red">
              This is taking longer than expected. If it does not clear in
              another minute or two, contact your system administrator.
            </Text>
          )}
        </Stack>
      </Modal>
    );
  }

  return null;
}
