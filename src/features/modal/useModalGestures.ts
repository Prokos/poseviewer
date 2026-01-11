import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Dispatch,
  MouseEvent,
  PointerEvent,
  RefObject,
  SetStateAction,
  TouchEvent,
  WheelEvent,
} from 'react';

type UseModalGesturesOptions = {
  modalImageId: string | null;
  modalZoom: number;
  modalPan: { x: number; y: number };
  setModalZoom: Dispatch<SetStateAction<number>>;
  setModalPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  modalImageSizeRef: RefObject<{ width: number; height: number } | null>;
  scheduleModalControlsHide: (force?: boolean) => void;
  pauseModalTimer: () => void;
  scheduleModalTimerResume: () => void;
  goPrevImage: () => void;
  goNextImage: (options?: { suppressControls?: boolean }) => void;
  onToggleFavoriteFromModal: () => void;
  onCloseModal: () => void;
};

export function useModalGestures({
  modalImageId,
  modalZoom,
  modalPan,
  setModalZoom,
  setModalPan,
  modalImageSizeRef,
  scheduleModalControlsHide,
  pauseModalTimer,
  scheduleModalTimerResume,
  goPrevImage,
  goNextImage,
  onToggleFavoriteFromModal,
  onCloseModal,
}: UseModalGesturesOptions) {
  const [modalSwipeAction, setModalSwipeAction] = useState<
    null | 'close' | 'favorite' | 'prev' | 'next'
  >(null);
  const [modalSwipeProgress, setModalSwipeProgress] = useState(0);

  const modalMediaRef = useRef<HTMLDivElement | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });
  const modalSwipeLockRef = useRef<null | 'close' | 'favorite' | 'prev' | 'next'>(null);
  const modalSwipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchLastRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    zoom: number;
    pointerX: number;
    pointerY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const oneHandZoomRef = useRef<{
    startY: number;
    zoom: number;
    pointerX: number;
    pointerY: number;
    worldX: number;
    worldY: number;
  } | null>(null);
  const oneHandZoomMovedRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastDoubleTapRef = useRef(0);
  const touchMovedRef = useRef(false);

  const getModalMaxZoom = useCallback(() => {
    const media = modalMediaRef.current;
    const bounds = media ? { width: media.clientWidth, height: media.clientHeight } : null;
    const size = modalImageSizeRef.current;
    if (!bounds || !size) {
      return 1.5;
    }
    if (size.width <= 0 || size.height <= 0) {
      return 1.5;
    }
    const baseScale = Math.min(bounds.width / size.width, bounds.height / size.height);
    if (!Number.isFinite(baseScale) || baseScale <= 0) {
      return 1.5;
    }
    return Math.max(1, 1.5 / baseScale);
  }, [modalImageSizeRef]);

  const clampModalPan = useCallback(
    (pan: { x: number; y: number }, zoom: number) => {
      const media = modalMediaRef.current;
      const bounds = media ? { width: media.clientWidth, height: media.clientHeight } : null;
      const size = modalImageSizeRef.current;
      if (!bounds || !size) {
        return pan;
      }
      if (size.width <= 0 || size.height <= 0) {
        return pan;
      }
      const baseScale = Math.min(bounds.width / size.width, bounds.height / size.height);
      if (!Number.isFinite(baseScale) || baseScale <= 0) {
        return pan;
      }
      const imageWidth = size.width * baseScale * zoom;
      const imageHeight = size.height * baseScale * zoom;
      const minVisible = 0.1;
      const minVisibleWidth = imageWidth * minVisible;
      const minVisibleHeight = imageHeight * minVisible;
      const viewLeft = -bounds.width / 2;
      const viewRight = bounds.width / 2;
      const viewTop = -bounds.height / 2;
      const viewBottom = bounds.height / 2;
      const minPanX = viewLeft + minVisibleWidth - imageWidth / 2;
      const maxPanX = viewRight - minVisibleWidth + imageWidth / 2;
      const minPanY = viewTop + minVisibleHeight - imageHeight / 2;
      const maxPanY = viewBottom - minVisibleHeight + imageHeight / 2;
      return {
        x: Math.min(maxPanX, Math.max(minPanX, pan.x)),
        y: Math.min(maxPanY, Math.max(minPanY, pan.y)),
      };
    },
    [modalImageSizeRef]
  );

  const resetZoomPan = useCallback(() => {
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (modalImageId) {
      resetZoomPan();
    }
  }, [modalImageId, resetZoomPan]);

  const handleModalWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    scheduleModalControlsHide(true);
    pauseModalTimer();
    scheduleModalTimerResume();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(getModalMaxZoom(), Math.max(1, modalZoom * zoomFactor));
    if (nextZoom === modalZoom) {
      return;
    }
    if (nextZoom === 1) {
      setModalZoom(1);
      setModalPan({ x: 0, y: 0 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pointerX = event.clientX - centerX;
    const pointerY = event.clientY - centerY;
    const worldX = (pointerX - modalPan.x) / modalZoom;
    const worldY = (pointerY - modalPan.y) / modalZoom;
    const nextPanX = pointerX - worldX * nextZoom;
    const nextPanY = pointerY - worldY * nextZoom;
    setModalZoom(nextZoom);
    setModalPan(clampModalPan({ x: nextPanX, y: nextPanY }, nextZoom));
  };

  const handleModalPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    if (event.button !== 0 || modalZoom <= 1) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button') && !target.closest('.modal-nav')) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    isPanningRef.current = true;
    pauseModalTimer();
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: modalPan.x,
      originY: modalPan.y,
    };
  };

  const handleModalPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    if (!isPanningRef.current) {
      return;
    }
    pauseModalTimer();
    scheduleModalTimerResume();
    const deltaX = event.clientX - panStartRef.current.x;
    const deltaY = event.clientY - panStartRef.current.y;
    const nextPan = {
      x: panStartRef.current.originX + deltaX,
      y: panStartRef.current.originY + deltaY,
    };
    setModalPan(clampModalPan(nextPan, modalZoom));
  };

  const handleModalPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    isPanningRef.current = false;
    scheduleModalTimerResume();
  };

  const handleModalMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (event.movementX === 0 && event.movementY === 0) {
      return;
    }
    scheduleModalControlsHide(true);
  };

  const handleModalTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    setModalSwipeAction(null);
    setModalSwipeProgress(0);
    modalSwipeLockRef.current = null;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button') && !target.closest('.modal-nav')) {
      return;
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      modalSwipeOriginRef.current = { x: touch.clientX, y: touch.clientY };
      const now = Date.now();
      const lastTap = lastTapRef.current;
      if (lastTap) {
        const dt = now - lastTap.time;
        if (dt < 300) {
          event.preventDefault();
          lastDoubleTapRef.current = now;
          const rect = event.currentTarget.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const pointerX = touch.clientX - centerX;
          const pointerY = touch.clientY - centerY;
          const worldX = (pointerX - modalPan.x) / modalZoom;
          const worldY = (pointerY - modalPan.y) / modalZoom;
          oneHandZoomRef.current = {
            startY: touch.clientY,
            zoom: modalZoom,
            pointerX,
            pointerY,
            worldX,
            worldY,
          };
          oneHandZoomMovedRef.current = false;
          touchStartRef.current = null;
          touchLastRef.current = null;
          lastTapRef.current = null;
          return;
        }
      }
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchLastRef.current = { x: touch.clientX, y: touch.clientY };
      pinchStartRef.current = null;
      touchMovedRef.current = false;
    } else if (event.touches.length === 2) {
      const [first, second] = Array.from(event.touches);
      if (!first || !second) {
        return;
      }
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const midX = (first.clientX + second.clientX) / 2;
      const midY = (first.clientY + second.clientY) / 2;
      pinchStartRef.current = {
        distance: Math.hypot(dx, dy),
        zoom: modalZoom,
        pointerX: midX - centerX,
        pointerY: midY - centerY,
        panX: modalPan.x,
        panY: modalPan.y,
      };
      touchStartRef.current = null;
      touchLastRef.current = null;
      oneHandZoomRef.current = null;
      oneHandZoomMovedRef.current = false;
      touchMovedRef.current = false;
    }
  };

  const handleModalTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) {
      return;
    }
    if (oneHandZoomRef.current && event.touches.length === 1) {
      event.preventDefault();
      pauseModalTimer();
      scheduleModalTimerResume();
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const deltaY = touch.clientY - oneHandZoomRef.current.startY;
      const zoomFactor = Math.exp(deltaY / 200);
      const nextZoom = Math.min(
        getModalMaxZoom(),
        Math.max(1, oneHandZoomRef.current.zoom * zoomFactor)
      );
      const start = oneHandZoomRef.current;
      const nextPanX = start.pointerX - start.worldX * nextZoom;
      const nextPanY = start.pointerY - start.worldY * nextZoom;
      setModalZoom(nextZoom);
      setModalPan(clampModalPan({ x: nextPanX, y: nextPanY }, nextZoom));
      oneHandZoomMovedRef.current = true;
      return;
    }
    if (event.touches.length === 2 && pinchStartRef.current) {
      event.preventDefault();
      pauseModalTimer();
      scheduleModalTimerResume();
      const [first, second] = Array.from(event.touches);
      if (!first || !second) {
        return;
      }
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      const distance = Math.hypot(dx, dy);
      const nextZoom = Math.min(
        getModalMaxZoom(),
        Math.max(1, (distance / pinchStartRef.current.distance) * pinchStartRef.current.zoom)
      );
      const start = pinchStartRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const midX = (first.clientX + second.clientX) / 2 - centerX;
      const midY = (first.clientY + second.clientY) / 2 - centerY;
      const worldX = (start.pointerX - start.panX) / start.zoom;
      const worldY = (start.pointerY - start.panY) / start.zoom;
      const nextPanX = midX - worldX * nextZoom;
      const nextPanY = midY - worldY * nextZoom;
      setModalZoom(nextZoom);
      setModalPan(clampModalPan({ x: nextPanX, y: nextPanY }, nextZoom));
      touchMovedRef.current = true;
      return;
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (touchStartRef.current) {
        const origin = modalSwipeOriginRef.current ?? touchStartRef.current;
        const dx = touch.clientX - origin.x;
        const dy = touch.clientY - origin.y;
        if (modalZoom <= 1.05) {
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const hintThreshold = 20;
          const commitThreshold = 80;
          if (modalSwipeAction) {
            if (modalSwipeAction === 'favorite' || modalSwipeAction === 'close') {
              if (absY < hintThreshold) {
                setModalSwipeAction(null);
                setModalSwipeProgress(0);
                modalSwipeOriginRef.current = { x: touch.clientX, y: touch.clientY };
              } else {
                setModalSwipeProgress(Math.min(1, absY / commitThreshold));
                if (absY > commitThreshold) {
                  const shift = absY - commitThreshold;
                  const direction = dy >= 0 ? 1 : -1;
                  modalSwipeOriginRef.current = {
                    x: origin.x,
                    y: origin.y + shift * direction,
                  };
                }
              }
            } else {
              if (absX < hintThreshold) {
                setModalSwipeAction(null);
                setModalSwipeProgress(0);
                modalSwipeOriginRef.current = { x: touch.clientX, y: touch.clientY };
              } else {
                setModalSwipeProgress(Math.min(1, absX / commitThreshold));
                if (absX > commitThreshold) {
                  const shift = absX - commitThreshold;
                  const direction = dx >= 0 ? 1 : -1;
                  modalSwipeOriginRef.current = {
                    x: origin.x + shift * direction,
                    y: origin.y,
                  };
                }
              }
            }
          } else if (modalSwipeLockRef.current) {
            const locked = modalSwipeLockRef.current;
            if (locked === 'favorite' || locked === 'close') {
              const matchesDirection =
                (locked === 'favorite' && dy < 0) || (locked === 'close' && dy > 0);
              if (matchesDirection && absY > hintThreshold) {
                setModalSwipeAction(locked);
                setModalSwipeProgress(Math.min(1, absY / commitThreshold));
              } else {
                setModalSwipeProgress(0);
              }
            } else {
              const matchesDirection =
                (locked === 'prev' && dx > 0) || (locked === 'next' && dx < 0);
              if (matchesDirection && absX > hintThreshold) {
                setModalSwipeAction(locked);
                setModalSwipeProgress(Math.min(1, absX / commitThreshold));
              } else {
                setModalSwipeProgress(0);
              }
            }
          } else if (absY > absX && absY > hintThreshold) {
            const action = dy < 0 ? 'favorite' : 'close';
            if (modalSwipeLockRef.current && modalSwipeLockRef.current !== action) {
              setModalSwipeProgress(0);
              return;
            }
            setModalSwipeAction(action);
            setModalSwipeProgress(Math.min(1, absY / commitThreshold));
            modalSwipeLockRef.current = action;
          } else if (absX > absY && absX > hintThreshold) {
            const action = dx > 0 ? 'prev' : 'next';
            if (modalSwipeLockRef.current && modalSwipeLockRef.current !== action) {
              setModalSwipeProgress(0);
              return;
            }
            setModalSwipeAction(action);
            setModalSwipeProgress(Math.min(1, absX / commitThreshold));
            modalSwipeLockRef.current = action;
          }
        }
        if (Math.hypot(dx, dy) > 10) {
          touchMovedRef.current = true;
        }
      }
      if (modalZoom > 1 && touchLastRef.current) {
        event.preventDefault();
        pauseModalTimer();
        scheduleModalTimerResume();
        const deltaX = touch.clientX - touchLastRef.current.x;
        const deltaY = touch.clientY - touchLastRef.current.y;
        setModalPan((current) =>
          clampModalPan({ x: current.x + deltaX, y: current.y + deltaY }, modalZoom)
        );
      }
      touchLastRef.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleModalTouchEnd = () => {
    if (pinchStartRef.current) {
      pinchStartRef.current = null;
      scheduleModalTimerResume();
      if (modalZoom <= 1.05) {
        resetZoomPan();
      }
      return;
    }
    if (oneHandZoomRef.current) {
      const shouldReset = !oneHandZoomMovedRef.current;
      oneHandZoomRef.current = null;
      oneHandZoomMovedRef.current = false;
      if (shouldReset || modalZoom <= 1.05) {
        resetZoomPan();
      }
      scheduleModalTimerResume();
      return;
    }
    if (!touchStartRef.current || !touchLastRef.current) {
      touchStartRef.current = null;
      touchLastRef.current = null;
      modalSwipeOriginRef.current = null;
      return;
    }
    const tapDx = touchLastRef.current.x - touchStartRef.current.x;
    const tapDy = touchLastRef.current.y - touchStartRef.current.y;
    const origin = modalSwipeOriginRef.current ?? touchStartRef.current;
    const dx = touchLastRef.current.x - origin.x;
    const dy = touchLastRef.current.y - origin.y;
    const rawAbsX = Math.abs(tapDx);
    const rawAbsY = Math.abs(tapDy);
    const swipeThreshold = 60;
    const verticalThreshold = 80;

    if (modalSwipeLockRef.current) {
      if (
        modalSwipeAction &&
        modalSwipeAction === modalSwipeLockRef.current &&
        modalSwipeProgress >= 1 &&
        modalZoom <= 1.05
      ) {
        if (modalSwipeAction === 'next') {
          goNextImage();
        } else if (modalSwipeAction === 'prev') {
          goPrevImage();
        } else if (modalSwipeAction === 'favorite') {
          onToggleFavoriteFromModal();
        } else if (modalSwipeAction === 'close') {
          onCloseModal();
        }
      }
    } else if (
      !modalSwipeAction &&
      rawAbsX > rawAbsY &&
      rawAbsX > swipeThreshold &&
      modalZoom <= 1.05
    ) {
      if (tapDx < 0) {
        goNextImage();
      } else {
        goPrevImage();
      }
    } else if (!modalSwipeAction && tapDy < -verticalThreshold && modalZoom <= 1.05) {
      onToggleFavoriteFromModal();
    } else if (!modalSwipeAction && tapDy > verticalThreshold && modalZoom <= 1.05) {
      onCloseModal();
    }

    if (!touchMovedRef.current && Math.abs(tapDx) < 6 && Math.abs(tapDy) < 6) {
      const zoneWidth = 88;
      const startX = touchStartRef.current.x;
      const viewportWidth = window.innerWidth;
      if (startX <= zoneWidth) {
        goPrevImage();
        touchStartRef.current = null;
        touchLastRef.current = null;
        touchMovedRef.current = false;
        setModalSwipeAction(null);
        setModalSwipeProgress(0);
        return;
      }
      if (startX >= viewportWidth - zoneWidth) {
        goNextImage();
        touchStartRef.current = null;
        touchLastRef.current = null;
        touchMovedRef.current = false;
        setModalSwipeAction(null);
        setModalSwipeProgress(0);
        return;
      }
      lastTapRef.current = {
        time: Date.now(),
        x: touchStartRef.current.x,
        y: touchStartRef.current.y,
      };
    }
    setModalSwipeAction(null);
    setModalSwipeProgress(0);
    modalSwipeLockRef.current = null;
    modalSwipeOriginRef.current = null;
    touchStartRef.current = null;
    touchLastRef.current = null;
    touchMovedRef.current = false;
  };

  return {
    modalSwipeAction,
    modalSwipeProgress,
    modalMediaRef,
    handleModalWheel,
    handleModalPointerDown,
    handleModalPointerMove,
    handleModalPointerUp,
    handleModalMouseMove,
    handleModalTouchStart,
    handleModalTouchMove,
    handleModalTouchEnd,
  };
}
