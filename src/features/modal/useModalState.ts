import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PoseSet } from '../../metadata';
import type { DriveImage } from '../../drive/types';

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
  setModalZoom: Dispatch<SetStateAction<number>>;
  setModalPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  resetModalTimerState: () => void;
  resetModalHistory: () => void;
  sampleHistoryRef: MutableRefObject<DriveImage[]>;
  sampleHistorySetRef: MutableRefObject<string | null>;
  resetInFlight: () => void;
  modalPulseTimeoutRef: MutableRefObject<number | null>;
  modalFavoritePulseTimeoutRef: MutableRefObject<number | null>;
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
  setModalZoom,
  setModalPan,
  resetModalTimerState,
  resetModalHistory,
  sampleHistoryRef,
  sampleHistorySetRef,
  resetInFlight,
  modalPulseTimeoutRef,
  modalFavoritePulseTimeoutRef,
  modalControlsTimeoutRef,
}: UseModalStateOptions) {
  const openModal = useCallback(
    (imageId: string, items: DriveImage[], label: string) => {
      requestViewerFullscreen();
      scheduleModalControlsHide(true);
      const index = items.findIndex((image) => image.id === imageId);
      updateModalItems(items);
      setModalContextLabel(label);
      setModalContextSetId(label === 'Set' && activeSet ? activeSet.id : null);
      resetModalMediaState();
      if (label === 'Sample' && activeSet) {
        sampleHistoryRef.current = items;
        sampleHistorySetRef.current = activeSet.id;
      } else {
        sampleHistoryRef.current = [];
        sampleHistorySetRef.current = null;
      }
      setModalImageId(imageId);
      setModalIndex(index >= 0 ? index : null);
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
      sampleHistoryRef,
      sampleHistorySetRef,
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
    resetModalMediaState();
    stopModalLoading();
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
    resetModalTimerState();
    resetModalHistory();
    sampleHistoryRef.current = [];
    sampleHistorySetRef.current = null;
    resetInFlight();
    if (modalPulseTimeoutRef.current) {
      window.clearTimeout(modalPulseTimeoutRef.current);
      modalPulseTimeoutRef.current = null;
    }
    if (modalFavoritePulseTimeoutRef.current) {
      window.clearTimeout(modalFavoritePulseTimeoutRef.current);
      modalFavoritePulseTimeoutRef.current = null;
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
    sampleHistoryRef,
    sampleHistorySetRef,
  ]);

  return { openModal, closeModal };
}
