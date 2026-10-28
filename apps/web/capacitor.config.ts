import type { CapacitorConfig } from '@capacitor/cli';

// Android shell around the same Vite bundle the website serves. The bundle is
// built with `--mode mobile` (.env.mobile) so it talks to the production API
// by absolute URL; the WebView itself serves the assets from https://localhost,
// which therefore has to be in the API's CORS_ORIGINS.
const config: CapacitorConfig = {
  appId: 'in.sirahdigital.difai',
  appName: 'DifAi',
  webDir: 'dist',
  backgroundColor: '#ffffff',
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
