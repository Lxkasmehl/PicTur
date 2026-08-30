/**
 * Applies a text mask (e.g. auto-inserting date slashes) on every keystroke
 * without the caret jumping to the end of the field, which otherwise makes it
 * impossible to go back and fix a typo in an earlier part of the value.
 */

import { useRef, useCallback, type ChangeEvent } from 'react';
import { alnumCountBeforeCursor, cursorPosForAlnumCount } from '../utils/usDateFormat';

export function useCursorPreservingMask(maskFn: (raw: string) => string) {
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>, onChange: (masked: string) => void) => {
      const input = e.target;
      const prevCursor = input.selectionStart ?? input.value.length;
      const alnumBefore = alnumCountBeforeCursor(input.value, prevCursor);
      const masked = maskFn(input.value);
      onChange(masked);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const pos = cursorPosForAlnumCount(masked, alnumBefore);
        el.setSelectionRange(pos, pos);
      });
    },
    [maskFn],
  );

  return { ref, handleChange };
}
