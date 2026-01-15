import { useCallback } from 'react';
import type { MouseEvent } from 'react';

export function useLoadMoreClick() {
  return useCallback(
    (handler: () => void | Promise<void>) =>
      (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const initialScrollY = window.scrollY;
        const initialScrollX = window.scrollX;
        const restoreIfJumpedToTop = () => {
          if (initialScrollY > 8 && window.scrollY < 8) {
            window.scrollTo({ top: initialScrollY, left: initialScrollX });
          }
        };
        event.currentTarget.blur();
        void Promise.resolve(handler()).finally(() => {
          requestAnimationFrame(restoreIfJumpedToTop);
        });
      },
    []
  );
}
