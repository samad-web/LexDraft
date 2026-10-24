import type { CapacitorConfig } from '@capacitor/cli';

// Android shell around the same Vite bundle the website serves. The bundle is
// built with `--mode mobile` (.env.mobile) so it talks to the production API
// by absolute URL; the WebView itself serves the assets from https://localhost,
// which therefore has to be in the API's CORS_ORIGINS.
const config: CapacitorConfig = {
  appId: 'in.sirahdigital.lexdraft',
  appName: 'LexDraft',
  webDir: 'dist',
  backgroundColor: '#ffffff',
  plugins: {
    SystemBars: {
      // The app is locked to a light theme: dark status-bar icons, and the
      // WebView is padded clear of the system bars (no viewport-fit=cover).
      insetsHandling: 'native',
      style: 'LIGHT',
    },
  },
};

export default config;
