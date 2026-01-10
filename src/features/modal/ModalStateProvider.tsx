import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ModalProvider } from './ModalContext';
import { ModalViewer } from '../../components/ModalViewer';
import type { DriveImage } from '../../drive/types';
import { useModalViewer, type ModalDeps } from '../../hooks/useModalViewer';

type ModalStateProviderProps = {
  deps: ModalDeps;
  thumbSize: number;
  onOpenModalReady?: (
    openModal: (imageId: string, images: DriveImage[], label: string, index?: number) => void
  ) => void;
  children: ReactNode;
};

export function ModalStateProvider({
  deps,
  thumbSize,
  onOpenModalReady,
  children,
}: ModalStateProviderProps) {
  const { modalState, openModal, closeModal } = useModalViewer(deps);

  useEffect(() => {
    if (onOpenModalReady) {
      onOpenModalReady(openModal);
    }
  }, [onOpenModalReady, openModal]);

  const value = {
    ...modalState,
    openModal,
    closeModal,
    thumbSize,
  };

  return (
    <ModalProvider value={value}>
      {children}
      <ModalViewer />
    </ModalProvider>
  );
}
