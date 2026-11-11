import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zhanghan.bookkeeping',
  appName: '记账本',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#ffffff',
      launchAutoHide: true,
      launchShowDuration: 600,
    },
  },
};

export default config;
