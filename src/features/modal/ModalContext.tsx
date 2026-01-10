import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { DriveImage } from '../../drive/types';
import type { ModalViewerState } from '../../hooks/useModalViewer';

type ModalContextValue = ModalViewerState & {
  openModal: (imageId: string, images: DriveImage[], label: string, index?: number) => void;
  closeModal: () => void;
  thumbSize: number;
};

const ModalContext = createContext<ModalContextValue | null>(null);

type ModalProviderProps = {
  value: ModalContextValue;
  children: ReactNode;
};

export function ModalProvider({ value, children }: ModalProviderProps) {
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return context;
}
