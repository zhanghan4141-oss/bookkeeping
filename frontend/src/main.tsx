import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { queryClient } from './lib/queryClient';
import './index.css';

// 网页端（浏览器）注册 PWA Service Worker；App（Capacitor WebView）不注册，
// 避免本地资源被 Service Worker 缓存旧版本，导致覆盖安装后仍显示旧界面
if (!Capacitor.isNativePlatform()) {
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
