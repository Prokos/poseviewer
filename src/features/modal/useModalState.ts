import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PoseSet } from '../../metadata';
import type { DriveImage } from '../../drive/types';
import type { ModalOpenOptions } from './types';

type UseModalStateOptions = {
  activeSet: PoseSet | null;
  scheduleModalControlsHide: (force?: boolean) => void;
  requestViewerFullscreen: () => void;
  exitViewerFullscreen: () => void;
  updateModalItems: (items: DriveImage[]) => void;
  setModalContextLabel: Dispatch<SetStateAction<string>>;
  setModalContextSetId: Dispatch<SetStateAction<string | null>>;
  resetModalMediaState: () => void;
  stopModalLoading: () => void;
  clearModalMediaCache: () => void;
  setModalImageId: Dispatch<SetStateAction<string | null>>;
  setModalIndex: Dispatch<SetStateAction<number | null>>;
  triggerModalPulse: () => void;
  setModalPulse: Dispatch<SetStateAction<boolean>>;
  setModalFavoritePulse: Dispatch<SetStateAction<null | 'add' | 'remove'>>;
  setModalHiddenPulse: Dispatch<SetStateAction<null | 'hide' | 'unhide'>>;
  setModalZoom: Dispatch<SetStateAction<number>>;
  setModalPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  resetModalTimerState: () => void;
  resetModalHistory: () => void;
  resetInFlight: () => void;
  modalPulseTimeoutRef: MutableRefObject<number | null>;
  modalFavoritePulseTimeoutRef: MutableRefObject<number | null>;
  modalHiddenPulseTimeoutRef: MutableRefObject<number | null>;
  modalControlsTimeoutRef: MutableRefObject<number | null>;
};

export function useModalState({
  activeSet,
  scheduleModalControlsHide,
  requestViewerFullscreen,
  exitViewerFullscreen,
  updateModalItems,
  setModalContextLabel,
  setModalContextSetId,
  resetModalMediaState,
  stopModalLoading,
  clearModalMediaCache,
  setModalImageId,
  setModalIndex,
  triggerModalPulse,
  setModalPulse,
  setModalFavoritePulse,
  setModalHiddenPulse,
  setModalZoom,
  setModalPan,
  resetModalTimerState,
  resetModalHistory,
  resetInFlight,
  modalPulseTimeoutRef,
  modalFavoritePulseTimeoutRef,
  modalHiddenPulseTimeoutRef,
  modalControlsTimeoutRef,
}: UseModalStateOptions) {
  const openModal = useCallback(
    (
      imageId: string,
      items: DriveImage[],
      label: string,
      index?: number,
      options?: ModalOpenOptions
    ) => {
      requestViewerFullscreen();
      scheduleModalControlsHide(true);
      const resolvedIndex =
        typeof index === 'number'
          ? Math.min(Math.max(0, index), items.length - 1)
          : items.findIndex((image) => image.id === imageId);
      updateModalItems(items);
      setModalContextLabel(label);
      setModalContextSetId(
        label === 'Set' ? options?.contextSetId ?? activeSet?.id ?? null : null
      );
      resetModalMediaState();
      setModalImageId(imageId);
      setModalIndex(resolvedIndex >= 0 ? resolvedIndex : null);
      triggerModalPulse();
    },
    [
      activeSet,
      requestViewerFullscreen,
      resetModalMediaState,
      scheduleModalControlsHide,
      setModalContextLabel,
      setModalContextSetId,
      setModalImageId,
      setModalIndex,
      triggerModalPulse,
      updateModalItems,
    ]
  );

  const closeModal = useCallback(() => {
    setModalIndex(null);
    setModalImageId(null);
    updateModalItems([]);
    setModalContextLabel('');
    setModalContextSetId(null);
    setModalPulse(false);
    setModalFavoritePulse(null);
    setModalHiddenPulse(null);
    resetModalMediaState();
    stopModalLoading();
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
    resetModalTimerState();
    resetModalHistory();
      resetInFlight();
    if (modalPulseTimeoutRef.current) {
      window.clearTimeout(modalPulseTimeoutRef.current);
      modalPulseTimeoutRef.current = null;
    }
    if (modalFavoritePulseTimeoutRef.current) {
      window.clearTimeout(modalFavoritePulseTimeoutRef.current);
      modalFavoritePulseTimeoutRef.current = null;
    }
    if (modalHiddenPulseTimeoutRef.current) {
      window.clearTimeout(modalHiddenPulseTimeoutRef.current);
      modalHiddenPulseTimeoutRef.current = null;
    }
    if (modalControlsTimeoutRef.current) {
      window.clearTimeout(modalControlsTimeoutRef.current);
      modalControlsTimeoutRef.current = null;
    }
    clearModalMediaCache();
    exitViewerFullscreen();
  }, [
    clearModalMediaCache,
    exitViewerFullscreen,
    modalControlsTimeoutRef,
    modalFavoritePulseTimeoutRef,
    modalPulseTimeoutRef,
    resetInFlight,
    resetModalHistory,
    resetModalMediaState,
    resetModalTimerState,
    setModalContextLabel,
    setModalContextSetId,
    setModalFavoritePulse,
    setModalImageId,
    setModalIndex,
    setModalPan,
    setModalPulse,
    setModalZoom,
    stopModalLoading,
    updateModalItems,
  ]);

  return { openModal, closeModal };
}
