import { useLoadMoreClick } from '../hooks/useLoadMoreClick';

type GridLoadButtonsProps =
  | {
      variant: 'sample';
      isLoading: boolean;
      currentCount: number;
      pendingCount: number;
      totalCount?: number;
      showLoadMore?: boolean;
      showLoadAll?: boolean;
      onLoadMore: () => void | Promise<void>;
      onLoadAll: () => void | Promise<void>;
    }
  | {
      variant: 'favorites';
      isLoading: boolean;
      currentCount: number;
      pendingCount: number;
      totalCount: number;
      remainingCount: number;
      showLoadMore?: boolean;
      showLoadAll?: boolean;
      onLoadMore: () => void | Promise<void>;
      onLoadAll: () => void | Promise<void>;
    }
  | {
      variant: 'nonfavorites';
      isLoading: boolean;
      currentCount: number;
      pendingCount: number;
      totalCount?: number;
      showLoadMore?: boolean;
      showLoadAll?: boolean;
      onLoadMore: () => void | Promise<void>;
      onLoadAll: () => void | Promise<void>;
    }
  | {
      variant: 'all';
      isLoading: boolean;
      currentCount: number;
      pendingCount: number;
      totalCount?: number;
      remainingCount?: number;
      showLoadMore?: boolean;
      showLoadAll?: boolean;
      onLoadMore: () => void | Promise<void>;
      onLoadAll?: () => void | Promise<void>;
    }
  | {
      variant: 'slideshow';
      isLoading: boolean;
      currentCount: number;
      pendingCount: number;
      disabled?: boolean;
      showLoadMore?: boolean;
      onLoadMore: () => void | Promise<void>;
    };

function renderLoadMoreLabel(props: GridLoadButtonsProps) {
  if (props.variant === 'favorites') {
    if (props.isLoading) {
      return `Loading... (+${props.pendingCount}) • ${props.currentCount}/${props.totalCount}`;
    }
    if (props.remainingCount > 0) {
      return `Load more favorites (+${props.pendingCount}) • ${props.currentCount}/${props.totalCount}`;
    }
    return `All favorites loaded (${props.currentCount})`;
  }

  if (props.variant === 'slideshow') {
    return props.isLoading
      ? `Loading... (+${props.pendingCount})`
      : `Load more images (+${props.pendingCount}) • ${props.currentCount}`;
  }

  const total = 'totalCount' in props ? props.totalCount : undefined;
  if (props.isLoading) {
    return total !== undefined
      ? `Loading... (+${props.pendingCount}) • ${props.currentCount}/${total}`
      : 'Loading images...';
  }
  if (total !== undefined) {
    if (props.currentCount > 0) {
      return `Load more images (+${props.pendingCount}) • ${props.currentCount}/${total}`;
    }
    return `Load images (+${props.pendingCount}) • ${props.currentCount}/${total}`;
  }
  if (props.currentCount > 0) {
    return `Load more images (+${props.pendingCount})`;
  }
  return `Load images (+${props.pendingCount})`;
}

function renderLoadAllLabel(props: GridLoadButtonsProps) {
  if (props.variant === 'favorites') {
    return props.isLoading
      ? `Loading all ${props.totalCount}...`
      : `Load all remaining ${props.remainingCount}`;
  }
  if (props.variant === 'nonfavorites') {
    const total = props.totalCount;
    return props.isLoading
      ? total !== undefined
        ? `Loading all ${total}...`
        : 'Loading all images...'
      : total !== undefined
        ? `Load all remaining ${Math.max(0, total - props.currentCount)} • ${props.currentCount}/${total}`
        : 'Load all remaining';
  }
  if (props.variant === 'sample') {
    const total = props.totalCount;
    return props.isLoading
      ? total !== undefined
        ? `Loading all ${total}...`
        : 'Loading all images...'
      : total !== undefined
        ? `Load all remaining ${Math.max(0, total - props.currentCount)}`
        : 'Load all remaining';
  }
  if (props.variant === 'all') {
    if (!props.onLoadAll || props.remainingCount === undefined) {
      return '';
    }
    const total = props.totalCount ?? props.currentCount;
    return props.isLoading
      ? `Loading all ${total}...`
      : `Load all remaining ${props.remainingCount}`;
  }
  return '';
}

export function GridLoadButtons(props: GridLoadButtonsProps) {
  const handleClick = useLoadMoreClick();
  const showLoadMore = props.showLoadMore ?? true;
  const showLoadAll =
    (props.showLoadAll ?? true) &&
    (props.variant === 'sample' ||
      props.variant === 'favorites' ||
      props.variant === 'nonfavorites' ||
      (props.variant === 'all' && props.onLoadAll && props.remainingCount !== undefined));

  const moreLabel = renderLoadMoreLabel(props);
  const moreDisabled =
    props.variant === 'favorites'
      ? props.isLoading || props.remainingCount === 0
      : props.variant === 'slideshow'
        ? props.isLoading || props.disabled
        : props.isLoading;

  const allLabel = showLoadAll ? renderLoadAllLabel(props) : '';
  const allDisabled =
    props.variant === 'favorites'
      ? props.isLoading || props.remainingCount === 0
      : props.isLoading;

  return (
    <>
      {showLoadMore ? (
        <button
          type="button"
          className="ghost load-more"
          onClick={handleClick(props.onLoadMore)}
          disabled={moreDisabled}
        >
          {moreLabel}
        </button>
      ) : null}
      {showLoadAll && allLabel ? (
        <button
          type="button"
          className="ghost load-more"
          onClick={handleClick(
            props.variant === 'all' ? props.onLoadAll ?? (() => {}) : props.onLoadAll
          )}
          disabled={allDisabled}
        >
          {allLabel}
        </button>
      ) : null}
    </>
  );
}
