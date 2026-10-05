/**
 * Applies a text mask (e.g. auto-inserting date slashes) on every keystroke
 * without the caret jumping to the end of the field, which otherwise makes it
 * impossible to go back and fix a typo in an earlier part of the value.
 *
 * The masked value and caret are written to the DOM synchronously inside the
 * change handler. React then finds the DOM value already equal to the new
 * controlled value and leaves it (and the caret) alone. Deferring the caret
 * restore (e.g. via requestAnimationFrame) races with fast follow-up keystrokes
 * — notably in WebKit — so they land at the wrong position.
 */

import { useCallback, type ChangeEvent } from 'react';
import { alnumCountBeforeCursor, cursorPosForAlnumCount } from '../utils/usDateFormat';

export function useCursorPreservingMask(maskFn: (raw: string) => string) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>, onChange: (masked: string) => void) => {
      const input = e.target;
      const prevCursor = input.selectionStart ?? input.value.length;
      const alnumBefore = alnumCountBeforeCursor(input.value, prevCursor);
      const masked = maskFn(input.value);
      if (input.value !== masked) {
        input.value = masked;
        const pos = cursorPosForAlnumCount(masked, alnumBefore);
        input.setSelectionRange(pos, pos);
      }
      onChange(masked);
    },
    [maskFn],
  );

  return { handleChange };
}
