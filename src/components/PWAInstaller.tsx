'use client';

import { useEffect } from 'react';

export default function PWAInstaller() {
  useEffect(() => {
    let isRefreshingForServiceWorker = false;
    const hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller);

    // Global error handlers for better mobile error handling
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error, event.message, event.filename, event.lineno);
      // Prevent default error handling that might crash the app
      event.preventDefault();
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      // Prevent default error handling
      event.preventDefault();
    };

    const handleServiceWorkerControllerChange = () => {
      if (!hadServiceWorkerController || isRefreshingForServiceWorker) return;
      isRefreshingForServiceWorker = true;
      window.location.reload();
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        handleServiceWorkerControllerChange,
      );

      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          console.log('SW registered: ', registration);
          return registration.update();
        })
        .catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
    }

    // Handle PWA install prompt
    let deferredPrompt: any;
    
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later
      deferredPrompt = e;
      
      // Show install button or notification
      console.log('PWA install prompt available');
    });

    window.addEventListener('appinstalled', () => {
      console.log('PWA was installed');
      deferredPrompt = null;
    });

    // Cleanup
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      navigator.serviceWorker?.removeEventListener(
        'controllerchange',
        handleServiceWorkerControllerChange,
      );
    };
  }, []);

  return null; // This component doesn't render anything
}
