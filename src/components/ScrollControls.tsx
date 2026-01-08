import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';

type ScrollControlsProps = {
  canScrollUp: boolean;
  canScrollDown: boolean;
  onScrollTop: () => void;
  onScrollBottom: () => void;
};

export function ScrollControls({
  canScrollUp,
  canScrollDown,
  onScrollTop,
  onScrollBottom,
}: ScrollControlsProps) {
  return (
    <div className="scroll-controls">
      <button
        type="button"
        className="scroll-control"
        onClick={onScrollTop}
        aria-label="Back to top"
        disabled={!canScrollUp}
      >
        <IconArrowUp size={18} />
      </button>
      <button
        type="button"
        className="scroll-control"
        onClick={onScrollBottom}
        aria-label="Scroll to bottom"
        disabled={!canScrollDown}
      >
        <IconArrowDown size={18} />
      </button>
    </div>
  );
}
