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
if (Capacitor.isNativePlatform()) {
  // App WebView：主动注销旧版本残留的 SW + 清缓存兜底。
  // 覆盖安装不清 WebView 缓存，旧版本注册的 SW 会继续拦截页面返回旧界面，
  // 这里在启动时注销并清空缓存，彻底摆脱旧 SW。
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  }
  if ('caches' in window) {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
} else {
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
