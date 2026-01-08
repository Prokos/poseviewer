import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

type UseModalTimerOptions = {
  modalImageId: string | null;
  goNextImageRef: MutableRefObject<
    (options?: { suppressControls?: boolean }) => void
  >;
  setModalControlsVisible: (visible: boolean) => void;
};

export function useModalTimer({
  modalImageId,
  goNextImageRef,
  setModalControlsVisible,
}: UseModalTimerOptions) {
  const [modalTimerMs, setModalTimerMs] = useState(0);
  const [modalTimerProgress, setModalTimerProgress] = useState(0);
  const [isModalTimerOpen, setIsModalTimerOpen] = useState(false);
  const [modalTimerFade, setModalTimerFade] = useState(false);
  const modalTimerIntervalRef = useRef<number | null>(null);
  const modalTimerStartRef = useRef(0);
  const modalTimerElapsedRef = useRef(0);
  const modalTimerPausedRef = useRef(false);
  const modalTimerResumeTimeoutRef = useRef<number | null>(null);
  const modalTimerFadeRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeFallbackRef = useRef<HTMLVideoElement | null>(null);
  const modalAutoAdvanceRef = useRef(false);

  const pauseModalTimer = useCallback(() => {
    if (modalTimerMs <= 0 || modalTimerPausedRef.current) {
      return;
    }
    modalTimerPausedRef.current = true;
    modalTimerElapsedRef.current += performance.now() - modalTimerStartRef.current;
    if (modalTimerFadeRef.current) {
      modalTimerFadeRef.current = false;
      setModalTimerFade(false);
    }
  }, [modalTimerMs]);

  const resumeModalTimer = useCallback(() => {
    if (modalTimerMs <= 0 || !modalTimerPausedRef.current) {
      return;
    }
    modalTimerPausedRef.current = false;
    modalTimerStartRef.current = performance.now();
  }, [modalTimerMs]);

  const scheduleModalTimerResume = useCallback(() => {
    if (modalTimerResumeTimeoutRef.current) {
      window.clearTimeout(modalTimerResumeTimeoutRef.current);
    }
    if (isModalTimerOpen) {
      return;
    }
    modalTimerResumeTimeoutRef.current = window.setTimeout(() => {
      modalTimerResumeTimeoutRef.current = null;
      resumeModalTimer();
    }, 300);
  }, [isModalTimerOpen, resumeModalTimer]);

  const startWakeFallback = useCallback(() => {
    if (wakeFallbackRef.current) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, 1, 1);
    }
    const stream = canvas.captureStream(1);
    const video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.srcObject = stream;
    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.left = '0';
    video.style.top = '0';
    document.body.appendChild(video);
    wakeFallbackRef.current = video;
    void video.play().catch(() => undefined);
  }, []);

  const stopWakeFallback = useCallback(() => {
    const video = wakeFallbackRef.current;
    if (!video) {
      return;
    }
    video.pause();
    video.remove();
    wakeFallbackRef.current = null;
  }, []);

  const onSelectModalTimer = useCallback(
    (value: number) => {
      setModalTimerMs(value);
      setIsModalTimerOpen(false);
      if (value > 0) {
        startWakeFallback();
      } else {
        stopWakeFallback();
      }
    },
    [startWakeFallback, stopWakeFallback]
  );

  const onResetModalTimer = useCallback(() => {
    if (modalTimerMs <= 0) {
      return;
    }
    modalTimerElapsedRef.current = 0;
    modalTimerPausedRef.current = false;
    modalTimerStartRef.current = performance.now();
    setModalTimerProgress(0);
    setModalTimerFade(false);
    setIsModalTimerOpen(false);
  }, [modalTimerMs]);

  const onToggleTimerMenu = useCallback(() => {
    setModalControlsVisible(true);
    setIsModalTimerOpen((current) => !current);
  }, [setModalControlsVisible]);

  const modalTimerOptions = useMemo(
    () => [
      { label: 'none', value: 0 },
      { label: '10s', value: 10_000 },
      { label: '30s', value: 30_000 },
      { label: '1min', value: 60_000 },
      { label: '2min', value: 120_000 },
      { label: '5min', value: 300_000 },
      { label: '10min', value: 600_000 },
    ],
    []
  );

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    if (modalTimerMs > 0 || modalAutoAdvanceRef.current) {
      setModalControlsVisible(false);
      modalAutoAdvanceRef.current = false;
    }
  }, [modalImageId, modalTimerMs, setModalControlsVisible]);

  useEffect(() => {
    if (!modalImageId || modalTimerMs <= 0) {
      if (modalTimerIntervalRef.current) {
        window.clearInterval(modalTimerIntervalRef.current);
        modalTimerIntervalRef.current = null;
      }
      setModalTimerProgress(0);
      setModalTimerFade(false);
      stopWakeFallback();
      return;
    }
    let isActive = true;
    modalTimerElapsedRef.current = 0;
    modalTimerPausedRef.current = false;
    modalTimerStartRef.current = performance.now();
    setModalTimerProgress(0);
    setModalTimerFade(false);
    const tick = (now: number) => {
      if (!isActive) {
        return;
      }
      const elapsed =
        modalTimerElapsedRef.current +
        (modalTimerPausedRef.current ? 0 : now - modalTimerStartRef.current);
      const remaining = Math.max(0, modalTimerMs - elapsed);
      const shouldFade = remaining <= 500 && !modalTimerPausedRef.current;
      if (modalTimerFadeRef.current !== shouldFade) {
        modalTimerFadeRef.current = shouldFade;
        setModalTimerFade(shouldFade);
      }
      const progress = Math.min(1, elapsed / modalTimerMs);
      setModalTimerProgress(progress);
      if (progress >= 1) {
        isActive = false;
        setModalTimerProgress(0);
        modalTimerElapsedRef.current = 0;
        modalTimerStartRef.current = performance.now();
        setModalControlsVisible(false);
        modalAutoAdvanceRef.current = true;
        goNextImageRef.current({ suppressControls: true });
        return;
      }
    };
    modalTimerIntervalRef.current = window.setInterval(() => {
      tick(performance.now());
    }, 50);
    return () => {
      isActive = false;
      if (modalTimerIntervalRef.current) {
        window.clearInterval(modalTimerIntervalRef.current);
        modalTimerIntervalRef.current = null;
      }
    };
  }, [goNextImageRef, modalImageId, modalTimerMs, setModalControlsVisible, stopWakeFallback]);

  useEffect(() => {
    if (!modalImageId || modalTimerMs <= 0 || typeof navigator === 'undefined') {
      return;
    }
    if (!('wakeLock' in navigator)) {
      startWakeFallback();
      return;
    }
    let isActive = true;
    const requestLock = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!isActive) {
          await lock.release();
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener('release', () => {
          if (wakeLockRef.current === lock) {
            wakeLockRef.current = null;
          }
        });
      } catch {
        startWakeFallback();
      }
    };
    requestLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => undefined);
        wakeLockRef.current = null;
      }
      stopWakeFallback();
    };
  }, [modalImageId, modalTimerMs, startWakeFallback, stopWakeFallback]);

  const resetModalTimerState = useCallback(() => {
    if (modalTimerResumeTimeoutRef.current) {
      window.clearTimeout(modalTimerResumeTimeoutRef.current);
      modalTimerResumeTimeoutRef.current = null;
    }
    setModalTimerMs(0);
    setModalTimerProgress(0);
    setModalTimerFade(false);
    setIsModalTimerOpen(false);
  }, []);

  return {
    modalTimerMs,
    modalTimerProgress,
    isModalTimerOpen,
    modalTimerFade,
    modalTimerOptions,
    onSelectModalTimer,
    onResetModalTimer,
    onToggleTimerMenu,
    pauseModalTimer,
    scheduleModalTimerResume,
    resetModalTimerState,
  };
}
