import { useCallback } from 'react';
import type { MouseEvent } from 'react';

export function useLoadMoreClick() {
  return useCallback(
    (handler: () => void | Promise<void>) =>
      (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.blur();
        void handler();
      },
    []
  );
}
