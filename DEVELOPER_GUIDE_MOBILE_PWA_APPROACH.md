# Developer Guide: Mobile-First PWA Approach for New Apps

## Overview

This guide outlines the proven mobile-first Progressive Web App (PWA) architecture that works excellently for iPhone and Android. Use this as a blueprint to build a new app with the same approach.

---

## 🎯 Core Architecture Stack

### Required Technologies:
- **Next.js 15+** (App Router)
- **React 19+**
- **TypeScript**
- **Tailwind CSS 4+**
- **Vercel** (or similar hosting with CDN)

### Why This Stack?
- ✅ **Next.js**: Server-side rendering, automatic code splitting, built-in optimizations
- ✅ **React**: Component-based, fast rendering, great mobile performance
- ✅ **TypeScript**: Type safety, fewer bugs, better developer experience
- ✅ **Tailwind CSS**: Responsive utilities, small bundle size, mobile-first
- ✅ **Vercel**: Global CDN, automatic optimizations, perfect for PWAs

---

## 📁 Required Files & Structure

### 1. **PWA Manifest** (`public/manifest.json`)

**Purpose**: Makes the app installable on mobile devices

```json
{
  "name": "Your App Name",
  "short_name": "App Name",
  "description": "Your app description",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icon-192.svg",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.svg",
      "sizes": "512x512",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ],
  "categories": ["business", "productivity"],
  "screenshots": [
    {
      "src": "/screenshot-mobile.png",
      "sizes": "390x844",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ]
}
```

**Key Settings:**
- `display: "standalone"` - Hides browser UI (native app feel)
- `orientation: "portrait-primary"` - Locks to portrait (or "landscape" if needed)
- `theme_color` - Sets status bar color on mobile
- Icons must be SVG or PNG (192x192 and 512x512 minimum)

---

### 2. **Service Worker** (`public/sw.js`)

**Purpose**: Enables offline functionality and caching

```javascript
// Service Worker for Your App PWA
const CACHE_NAME = 'your-app-v1';
const urlsToCache = [
  '/',
  '/your-main-pages',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  // Skip caching for API routes and non-GET requests
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request).catch(() => {
      return new Response(JSON.stringify({ error: 'Network error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        return fetch(event.request).then((fetchResponse) => {
          // Only cache successful responses
          if (fetchResponse && fetchResponse.status === 200) {
            const responseToCache = fetchResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return fetchResponse;
        }).catch((error) => {
          console.error('Fetch failed:', error);
          // Return cached home page for navigation failures
          if (event.request.mode === 'navigate') {
            return caches.match('/') || new Response('Offline', { status: 503 });
          }
          throw error;
        });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
```

**Update:**
- Change `CACHE_NAME` to your app name
- Update `urlsToCache` with your main pages
- Adjust API route patterns if needed

---

### 3. **Root Layout** (`src/app/layout.tsx`)

**Purpose**: Configures viewport, metadata, and PWA setup

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/Navigation";
import PWAInstaller from "@/components/PWAInstaller";
import { ErrorBoundaryWrapper } from "@/components/ErrorBoundaryWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Your App Name",
  description: "Your app description",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Your App",
  },
  icons: {
    icon: "/icon-192.svg",
    apple: "/icon-192.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,  // Prevents zoom (native app feel)
  themeColor: "#3b82f6",  // Match your brand color
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundaryWrapper>
          <div className="min-h-screen bg-gray-50">
            <Navigation />
            <main className="flex-1">
              {children}
            </main>
            <PWAInstaller />
          </div>
        </ErrorBoundaryWrapper>
      </body>
    </html>
  );
}
```

**Key Points:**
- `userScalable: false` - Prevents accidental zoom (better UX)
- `appleWebApp.capable: true` - Enables full-screen on iOS
- `PWAInstaller` component handles service worker registration

---

### 4. **PWA Installer Component** (`src/components/PWAInstaller.tsx`)

**Purpose**: Registers service worker and handles install prompts

```typescript
'use client';

import { useEffect } from 'react';

export default function PWAInstaller() {
  useEffect(() => {
    // Global error handlers for better mobile error handling
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error, event.message);
      // Prevent default error handling that might crash the app
      event.preventDefault();
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      event.preventDefault();
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('SW registered: ', registration);
        })
        .catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
    }

    // Handle PWA install prompt
    let deferredPrompt: any;
    
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent Chrome from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later
      deferredPrompt = e;
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
    };
  }, []);

  return null; // This component doesn't render anything
}
```

**What it does:**
- Registers service worker automatically
- Handles install prompts (can be extended to show custom install button)
- Global error handling prevents app crashes

---

### 5. **Responsive Navigation** (`src/components/Navigation.tsx`)

**Purpose**: Mobile-friendly navigation with hamburger menu

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  HomeIcon,
  // ... other icons
  Bars3Icon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { useState } from 'react'

const navigation = [
  { name: 'Home', href: '/', icon: HomeIcon },
  // ... your navigation items
]

export function Navigation() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <div className="flex-shrink-0">
              {/* Your logo */}
            </div>
            <span className="ml-2 text-lg font-semibold text-gray-900">Your App</span>
          </div>

          {/* Desktop Navigation - Hidden on mobile */}
          <div className="hidden md:flex items-center space-x-8">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                    isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon className={`mr-2 h-5 w-5 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
                  {item.name}
                </Link>
              )
            })}
          </div>

          {/* Mobile menu button - Visible only on mobile */}
          <div className="md:hidden flex items-center">
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <Bars3Icon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu - Slides down when open */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    onClick={() => setMobileMenuOpen(false)}  // Auto-close on click
                  >
                    <item.icon className={`mr-3 h-5 w-5 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
```

**Key Patterns:**
- `hidden md:flex` - Hide on mobile, show on desktop
- `md:hidden` - Show on mobile, hide on desktop
- Hamburger menu toggles mobile menu
- Auto-closes when navigation item clicked

---

### 6. **Next.js Configuration** (`next.config.ts`)

**Purpose**: Optimizes app for mobile performance

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Performance optimizations
  compress: true,  // Enable gzip compression
  poweredByHeader: false,  // Remove X-Powered-By header
  reactStrictMode: true,
  
  // Optimize package imports to reduce bundle size
  experimental: {
    optimizePackageImports: [
      '@heroicons/react',
      // Add other large packages here
    ],
  },
  
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],  // Modern formats
    minimumCacheTTL: 60,
  },
};

export default nextConfig;
```

**Benefits:**
- Smaller bundle sizes = faster mobile loading
- Optimized images = less data usage
- Code splitting = load only what's needed

---

## 🎨 Responsive Design Patterns

### Tailwind CSS Breakpoints:
- Default: Mobile first (< 640px)
- `sm:` - 640px and up (small tablets)
- `md:` - 768px and up (tablets)
- `lg:` - 1024px and up (desktops)
- `xl:` - 1280px and up (large desktops)

### Common Patterns:

**1. Responsive Grid:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* 1 column on mobile, 2 on tablet, 3 on desktop */}
</div>
```

**2. Show/Hide Based on Screen Size:**
```tsx
{/* Desktop only */}
<div className="hidden md:block">Desktop Content</div>

{/* Mobile only */}
<div className="md:hidden">Mobile Content</div>
```

**3. Responsive Padding:**
```tsx
<div className="p-4 md:p-6 lg:p-8">
  {/* More padding on larger screens */}
</div>
```

**4. Responsive Text:**
```tsx
<h1 className="text-2xl md:text-3xl lg:text-4xl">
  {/* Larger text on bigger screens */}
</h1>
```

**5. Responsive Flex Direction:**
```tsx
<div className="flex flex-col md:flex-row">
  {/* Stack on mobile, side-by-side on desktop */}
</div>
```

---

## 📱 Mobile-Specific UI Guidelines

### 1. **Touch Targets**
- Minimum **44x44px** (iOS/Android guidelines)
- Adequate spacing between interactive elements
- Large tap areas for buttons and links

### 2. **Form Inputs**
- Full-width inputs on mobile: `w-full`
- Proper input types trigger mobile keyboards:
  - `type="email"` → Email keyboard
  - `type="tel"` → Phone keyboard
  - `type="date"` → Date picker
  - `type="number"` → Numeric keyboard

### 3. **Modals/Dialogs**
- Full-screen or near full-screen on mobile
- Scrollable content: `max-h-[90vh] overflow-y-auto`
- Easy-to-reach close buttons
- Backdrop overlay for focus

### 4. **Tables**
- Horizontal scroll on mobile: `overflow-x-auto`
- Consider card layout for mobile instead of tables
- Sticky headers if needed

### 5. **Buttons**
- Adequate padding: `px-4 py-2` minimum
- Clear visual feedback on tap
- Loading states for async actions

---

## 🚀 Implementation Checklist

### Phase 1: Project Setup
- [ ] Create Next.js 15 project with TypeScript and Tailwind
- [ ] Install dependencies: `@heroicons/react`, etc.
- [ ] Set up Vercel (or hosting platform)
- [ ] Configure environment variables

### Phase 2: PWA Setup
- [ ] Create `public/manifest.json`
- [ ] Create `public/sw.js` service worker
- [ ] Create app icons (192x192 and 512x512)
- [ ] Create `src/components/PWAInstaller.tsx`
- [ ] Update `src/app/layout.tsx` with viewport and metadata
- [ ] Test service worker registration

### Phase 3: Responsive Navigation
- [ ] Create `src/components/Navigation.tsx`
- [ ] Implement hamburger menu for mobile
- [ ] Test on mobile devices
- [ ] Ensure auto-close on navigation

### Phase 4: Mobile-Optimized Pages
- [ ] Design mobile-first layouts
- [ ] Use responsive Tailwind classes
- [ ] Test touch targets (44x44px minimum)
- [ ] Optimize forms for mobile keyboards
- [ ] Test modals/dialogs on mobile

### Phase 5: Performance Optimization
- [ ] Configure `next.config.ts`
- [ ] Optimize images
- [ ] Implement code splitting
- [ ] Add loading states
- [ ] Test bundle sizes

### Phase 6: Testing
- [ ] Test on iPhone (Safari)
- [ ] Test on Android (Chrome)
- [ ] Test install process
- [ ] Test offline functionality
- [ ] Test on slow 3G connection
- [ ] Verify touch interactions

---

## 📋 Key Files Summary

| File | Purpose | Required |
|------|---------|----------|
| `public/manifest.json` | PWA configuration | ✅ Yes |
| `public/sw.js` | Service worker for offline/caching | ✅ Yes |
| `src/app/layout.tsx` | Root layout with viewport config | ✅ Yes |
| `src/components/PWAInstaller.tsx` | Service worker registration | ✅ Yes |
| `src/components/Navigation.tsx` | Responsive navigation | ✅ Yes |
| `next.config.ts` | Performance optimizations | ✅ Yes |
| `public/icon-192.svg` | App icon (small) | ✅ Yes |
| `public/icon-512.svg` | App icon (large) | ✅ Yes |
| `public/screenshot-mobile.png` | App store screenshot | ⚠️ Optional |

---

## 🎯 Mobile Best Practices

### 1. **Performance**
- Keep bundle sizes small (< 500KB initial load)
- Use code splitting for large components
- Optimize images (WebP, AVIF formats)
- Minimize API calls (use caching, debouncing)

### 2. **User Experience**
- Fast initial load (< 3 seconds on 3G)
- Smooth animations (60fps)
- Clear loading states
- Error handling with user-friendly messages

### 3. **Accessibility**
- Proper semantic HTML
- ARIA labels where needed
- Keyboard navigation support
- Screen reader friendly

### 4. **Offline Support**
- Cache critical pages
- Show offline indicator
- Queue actions for when online
- Graceful degradation

---

## 🔧 Common Patterns to Implement

### 1. **Search with Debouncing**
```typescript
useEffect(() => {
  const timeoutId = setTimeout(() => {
    fetchData(searchTerm)
  }, 300) // Wait 300ms after user stops typing

  return () => clearTimeout(timeoutId)
}, [searchTerm])
```

### 2. **Loading States**
```tsx
{loading ? (
  <div className="animate-pulse">
    {/* Skeleton loader */}
  </div>
) : (
  {/* Actual content */}
)}
```

### 3. **Error Boundaries**
```tsx
<ErrorBoundaryWrapper>
  {/* Your app content */}
</ErrorBoundaryWrapper>
```

### 4. **Responsive Tables**
```tsx
<div className="overflow-x-auto">
  <table className="min-w-full">
    {/* Table content */}
  </table>
</div>
```

---

## 📱 Testing on Real Devices

### iPhone Testing:
1. Deploy to staging/production URL
2. Open in Safari on iPhone
3. Tap Share → "Add to Home Screen"
4. Test all functionality
5. Test offline mode

### Android Testing:
1. Deploy to staging/production URL
2. Open in Chrome on Android
3. Tap menu → "Add to Home Screen" or "Install App"
4. Test all functionality
5. Test offline mode

### Testing Checklist:
- [ ] App installs correctly
- [ ] Icons display properly
- [ ] Navigation works smoothly
- [ ] Forms are easy to use
- [ ] Touch targets are adequate
- [ ] Text is readable
- [ ] Performance is acceptable
- [ ] Offline mode works
- [ ] No console errors

---

## 🎨 Design System Recommendations

### Colors:
- Use consistent color palette
- Ensure sufficient contrast (WCAG AA minimum)
- Theme color matches brand

### Typography:
- Readable font sizes (minimum 16px for body)
- Responsive font sizes
- Clear hierarchy

### Spacing:
- Consistent spacing scale
- Adequate padding for touch targets
- Breathing room between elements

---

## 💡 Pro Tips

1. **Start Mobile-First**: Design for mobile, then enhance for desktop
2. **Test Early**: Test on real devices throughout development
3. **Performance Matters**: Mobile users have slower connections
4. **Offline is Important**: Users expect apps to work offline
5. **Error Handling**: Mobile apps crash easily - handle errors gracefully
6. **Loading States**: Always show loading states (perceived performance)
7. **Touch Feedback**: Provide visual feedback on interactions
8. **Keyboard Handling**: Consider keyboard appearance on mobile

---

## 📚 Additional Resources

- **Next.js PWA Docs**: https://nextjs.org/docs/app/building-your-application/configuring/progressive-web-apps
- **Web.dev PWA Guide**: https://web.dev/progressive-web-apps/
- **Tailwind Responsive Design**: https://tailwindcss.com/docs/responsive-design
- **Service Worker API**: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

---

## ✅ Success Criteria

Your app is ready when:
- ✅ Installs on iPhone and Android
- ✅ Works offline (cached pages)
- ✅ Fast initial load (< 3s on 3G)
- ✅ Smooth navigation
- ✅ Touch-friendly interface
- ✅ Responsive on all screen sizes
- ✅ No console errors
- ✅ Good performance scores (Lighthouse)

---

## 🎯 Summary

This approach creates a **native-like mobile app experience** using web technologies:

1. **PWA Manifest** → Makes app installable
2. **Service Worker** → Enables offline support
3. **Responsive Design** → Works on all devices
4. **Mobile-First UI** → Touch-friendly interface
5. **Performance Optimization** → Fast loading
6. **Error Handling** → Prevents crashes

The result is a **cross-platform mobile app** that works on both iPhone and Android without native development or app stores.

