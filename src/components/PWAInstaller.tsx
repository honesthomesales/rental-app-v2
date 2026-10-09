'use client';

import { useEffect } from 'react';

export default function PWAInstaller() {
  useEffect(() => {
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

    const handleAppInstalled = () => {
      console.log('PWA was installed');
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Cleanup
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  return null; // This component doesn't render anything
}
