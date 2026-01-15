import { useEffect, useMemo } from 'react';
import { ModalStateContextProvider } from './ModalContext';
import { ModalViewer } from '../../components/ModalViewer';
import type { DriveImage } from '../../drive/types';
import type { ModalOpenOptions } from './types';
import { useModalViewer, type ModalDeps } from '../../hooks/useModalViewer';

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
};

export function ModalStateProvider({
  deps,
  thumbSize,
  onOpenModalReady,
}: ModalStateProviderProps) {
  const { modalState, openModal, closeModal } = useModalViewer(deps);

  useEffect(() => {
    if (onOpenModalReady) {
      onOpenModalReady(openModal);
    }
  }, [onOpenModalReady, openModal]);

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
