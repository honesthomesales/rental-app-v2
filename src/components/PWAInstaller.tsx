'use client';

import { useEffect } from 'react';

export default function PWAInstaller() {
  useEffect(() => {
    let isRefreshingForServiceWorker = false;
    const hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller);

    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error, event.message, event.filename, event.lineno);
      event.preventDefault();
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      event.preventDefault();
    };

    const handleServiceWorkerControllerChange = () => {
      if (!hadServiceWorkerController || isRefreshingForServiceWorker) return;
      isRefreshingForServiceWorker = true;
      window.location.reload();
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        handleServiceWorkerControllerChange,
      );

      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then(async (registration) => {
          console.log('SW registered: ', registration);
          await registration.update();

          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
    }

    let deferredPrompt: Event | null = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      console.log('PWA install prompt available');
    });

    window.addEventListener('appinstalled', () => {
      console.log('PWA was installed');
      deferredPrompt = null;
    });

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      navigator.serviceWorker?.removeEventListener(
        'controllerchange',
        handleServiceWorkerControllerChange,
      );
    };
  }, []);

  return null;
}
