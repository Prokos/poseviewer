import { useEffect, useMemo } from 'react';
import { ModalStateContextProvider } from './ModalContext';
import { ModalViewer } from '../../components/ModalViewer';
import type { DriveImage } from '../../drive/types';
import type { ModalOpenOptions } from './types';
import { useModalViewer, type ModalDeps, type ModalViewerState } from '../../hooks/useModalViewer';

type ModalStateProviderProps = {
  deps: ModalDeps;
  thumbSize: number;
  onOpenModalReady?: (
    openModal: (
      imageId: string,
      images: DriveImage[],
      label: string,
      index?: number,
      options?: ModalOpenOptions
    ) => void
  ) => void;
  onModalStateChange?: (state: ModalViewerState) => void;
};

export function ModalStateProvider({
  deps,
  thumbSize,
  onOpenModalReady,
  onModalStateChange,
}: ModalStateProviderProps) {
  const { modalState, openModal, closeModal } = useModalViewer(deps);

  useEffect(() => {
    if (onOpenModalReady) {
      onOpenModalReady(openModal);
    }
  }, [onOpenModalReady, openModal]);

  useEffect(() => {
    if (onModalStateChange) {
      onModalStateChange(modalState);
    }
  }, [modalState, onModalStateChange]);

  const stateValue = useMemo(
    () => ({
      ...modalState,
      onCloseModal: closeModal,
      thumbSize,
    }),
    [closeModal, modalState, thumbSize]
  );

  return (
    <ModalStateContextProvider value={stateValue}>
      <ModalViewer />
    </ModalStateContextProvider>
  );
}
