import { useActiveOrg } from '../hooks/useActiveOrg';

/**
 * Where turtle records live for the active research group: the main group's Google Sheets, or the
 * PicTur database for every other group (same tabs and columns, no Google).
 * `inline` is for running text ("… to the database"), otherwise a title-style name.
 */
export function StorageName({ inline = false }: { inline?: boolean }) {
  const { isDbOrg } = useActiveOrg();
  if (!isDbOrg) return <>Google Sheets</>;
  return <>{inline ? 'the database' : 'Database'}</>;
}
