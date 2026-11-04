import type { CapacitorConfig } from '@capacitor/cli';

// Android shell that loads the live website, so every web deploy reaches the
// app on its next open without a Play release (user's choice, 2026-11-04).
// Only native changes (plugins, permissions, icon) need a new APK/AAB. The
// bundled dist/ (built with --mode mobile) now only supplies offline.html.
const config: CapacitorConfig = {
  appId: 'in.sirahdigital.difai',
  appName: 'DifAi',
  webDir: 'dist',
  backgroundColor: '#ffffff',
  server: {
    url: 'https://difai.sirahdigital.in',
    // Served from the APK when the site can't be reached (offline, 5xx).
    errorPath: 'offline.html',
  },
  plugins: {
    SystemBars: {
      // The app is locked to a light theme: dark status-bar icons, and the
      // WebView is padded clear of the system bars (no viewport-fit=cover).
      insetsHandling: 'native',
      style: 'LIGHT',
    },
    // Native Google sign-in (Credential Manager). Only Google is bundled, so
    // no Facebook SDK / advertising-id permission ends up in the APK.
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
      logLevel: 1,
    },
  },
};

export default config;
