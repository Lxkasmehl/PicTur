import { useActiveOrg } from './useActiveOrg';

/**
 * Words for where a turtle record lives. The main group stores turtles in Google Sheets tabs;
 * research groups have no spreadsheet, so the same thing is called a "program" there.
 */
export function useProgramTerms() {
  const { isDbOrg } = useActiveOrg();
  return isDbOrg
    ? {
        isDbOrg,
        /** Title case, e.g. "Program". */
        Tab: 'Program',
        /** Lower case for running text, e.g. "program". */
        tab: 'program',
        tabs: 'programs',
        /** Label of the tab picker in the turtle data form. */
        fieldLabel: 'Program',
        fieldDescription: 'The program (study or project) this turtle belongs to',
      }
    : {
        isDbOrg,
        Tab: 'Sheet',
        tab: 'sheet',
        tabs: 'sheets',
        fieldLabel: 'Sheet / Location',
        fieldDescription: 'Select the Google Sheets tab where this turtle data should be stored',
      };
}
