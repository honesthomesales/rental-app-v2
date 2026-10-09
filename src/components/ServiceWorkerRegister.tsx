'use client';

import { useEffect } from 'react';

/** Registers the production service worker on every page, including login. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let isRefreshingForServiceWorker = false;
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);

    const handleServiceWorkerControllerChange = () => {
      if (!hadServiceWorkerController || isRefreshingForServiceWorker) return;
      isRefreshingForServiceWorker = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleServiceWorkerControllerChange,
    );

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        console.log('SW registered: ', registration);
        return registration.update();
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleServiceWorkerControllerChange,
      );
    };
  }, []);

  return null;
}
