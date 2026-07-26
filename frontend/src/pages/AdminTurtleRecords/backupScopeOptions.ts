/**
 * "What to download" option derivation for the scoped offline backup.
 *
 * Pure + framework-free so it can be reasoned about (and unit-tested) in
 * isolation. Global callers (admins, global-scope staff leads) get Everything +
 * every State + every Location from the folder list. A scoped team lead only
 * gets the States/Locations WITHIN their assigned areas — mirroring the backend
 * `scope_allows_location` rule (an option is offered only when it equals or sits
 * under an owned area), so the dropdown never offers a target the server would
 * 403. The server independently clamps at token-mint time, so this is UX only.
 */
import type { BackupScope } from '../../services/api/sheets';
import type { ComboboxData, ComboboxItem, ComboboxItemGroup } from '@mantine/core';

/** Sentinel value for the "Everything" option. */
export const BACKUP_ALL_VALUE = '__all__';

/** System / non-location folders that are never offered as a scope target
 *  (they are still included by "Everything"). Mirrors HomePage's list. */
const SYSTEM_FOLDERS = new Set([
  'Community_Uploads',
  'Review_Queue',
  'Incidental_Finds',
  'Incidental Places',
  'benchmarks',
]);

/** Map a chosen dropdown value to the {@link BackupScope} sent to the API. */
export function backupTargetForValue(value: string): BackupScope {
  return value === BACKUP_ALL_VALUE ? { scope: 'all' } : { scope: 'area', area: value };
}

/**
 * True when `option` is at or below one of the owned `areas` — i.e. the backend
 * would allow a `scope=area` backup of it. Mirrors `scope_allows_location` /
 * `area_covers(area, option)`: a `Kansas/Topeka` owner may back up
 * `Kansas/Topeka` (equal) or anything under it, but NOT the broader `Kansas`.
 */
function ownedAreaCovers(areas: string[], option: string): boolean {
  const opt = option.trim();
  if (!opt) return false;
  return areas.some((raw) => {
    const area = (raw || '').trim();
    if (!area) return false;
    return opt === area || opt.startsWith(area + '/');
  });
}

/**
 * Build the grouped `Select` data (Everything / States / Locations) for the
 * caller. `locations` is the `getLocations()` folder list (State + State/Sub
 * paths); `areas` is the caller's assigned area prefixes (only consulted for a
 * scoped caller).
 */
export function buildBackupScopeOptions(params: {
  isGlobal: boolean;
  areas: string[];
  locations: string[];
}): ComboboxData {
  const { isGlobal, areas, locations } = params;

  const states = new Set<string>();
  const subLocations = new Set<string>(); // "State/Sub"

  for (const raw of locations) {
    const path = (raw || '').trim();
    if (!path) continue;
    const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
    const state = parts[0];
    if (!state || SYSTEM_FOLDERS.has(state)) continue;
    states.add(state);
    if (parts.length > 1) subLocations.add(`${state}/${parts.slice(1).join('/')}`);
  }

  // Seed the caller's owned areas directly (scoped only) so an owned area is
  // always offered even if it has no folder yet in the location list.
  if (!isGlobal) {
    for (const raw of areas) {
      const area = (raw || '').trim();
      if (!area || SYSTEM_FOLDERS.has(area.split('/')[0])) continue;
      if (area.includes('/')) subLocations.add(area);
      else states.add(area);
    }
  }

  const allowed = (opt: string) => isGlobal || ownedAreaCovers(areas, opt);
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' });

  const stateItems: ComboboxItem[] = [...states]
    .filter(allowed)
    .sort(byName)
    .map((s) => ({ value: s, label: s }));

  const locationItems: ComboboxItem[] = [...subLocations]
    .filter(allowed)
    .sort(byName)
    .map((loc) => ({ value: loc, label: loc }));

  const everythingLabel = isGlobal ? 'Everything' : 'Everything (my areas)';
  const data: ComboboxItemGroup[] = [
    { group: 'Everything', items: [{ value: BACKUP_ALL_VALUE, label: everythingLabel }] },
  ];
  if (stateItems.length) data.push({ group: 'States', items: stateItems });
  if (locationItems.length) data.push({ group: 'Locations', items: locationItems });
  return data;
}
