import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { DriveImage } from '../../drive/types';
import type { ModalViewerState } from '../../hooks/useModalViewer';

type ModalActionsContextValue = {
  openModal: (imageId: string, images: DriveImage[], label: string, index?: number) => void;
};

type ModalStateContextValue = ModalViewerState & {
  thumbSize: number;
};

const ModalActionsContext = createContext<ModalActionsContextValue | null>(null);
const ModalStateContext = createContext<ModalStateContextValue | null>(null);

type ModalActionsProviderProps = {
  value: ModalActionsContextValue;
  children: ReactNode;
};

type ModalStateProviderProps = {
  value: ModalStateContextValue;
  children: ReactNode;
};

export function ModalActionsProvider({ value, children }: ModalActionsProviderProps) {
  return <ModalActionsContext.Provider value={value}>{children}</ModalActionsContext.Provider>;
}

export function ModalStateContextProvider({ value, children }: ModalStateProviderProps) {
  return <ModalStateContext.Provider value={value}>{children}</ModalStateContext.Provider>;
}

export function useModalActions() {
  const context = useContext(ModalActionsContext);
  if (!context) {
    throw new Error('useModalActions must be used within ModalActionsProvider');
  }
  return context;
}

export function useModalState() {
  const context = useContext(ModalStateContext);
  if (!context) {
    throw new Error('useModalState must be used within ModalStateContextProvider');
  }
  return context;
}
