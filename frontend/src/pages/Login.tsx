import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Toast } from 'antd-mobile';
import { Capacitor } from '@capacitor/core';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/auth';

const APK_URL = 'https://bookkeeping.zhangyuning.xyz/app-update/bookkeeping-latest.apk';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // iOS 检测（用于「添加到主屏幕」引导）
    const ua = navigator.userAgent;
    setIsIOS(/iPhone|iPad|iPod/i.test(ua));

    // Android Chrome 等的 PWA 安装提示（beforeinstallprompt）
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const installPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const downloadApp = () => {
    const a = document.createElement('a');
    a.href = APK_URL;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onFinish = async (values: { email: string; password: string; nickname?: string }) => {
    setLoading(true);
    try {
      const res = isRegister
        ? await authApi.register({
            email: values.email,
            password: values.password,
            nickname: values.nickname ?? values.email.split('@')[0],
          })
        : await authApi.login({ email: values.email, password: values.password });
      setAuth(res.data);
      Toast.show({ content: isRegister ? '注册成功' : '登录成功' });
      navigate('/ledgers', { replace: true });
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        minHeight: '100vh',
        background: '#fff',
        padding: '40px 24px',
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>记账本</h1>
      <p className="text-secondary" style={{ marginBottom: 32 }}>
        {isRegister ? '创建账号，和家人一起记账' : '欢迎回来'}
      </p>

      <Form
        layout="vertical"
        onFinish={onFinish}
        footer={
          <Button block type="submit" color="primary" size="large" loading={loading}>
            {isRegister ? '注册' : '登录'}
          </Button>
        }
      >
        {isRegister && (
          <Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
            <Input placeholder="你的昵称" />
          </Form.Item>
        )}
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input placeholder="example@email.com" type="email" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input placeholder="至少 6 位" type="password" clearable />
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <a onClick={() => setIsRegister(!isRegister)} style={{ color: '#1677ff' }}>
          {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
        </a>
      </div>

      {/* 下载 App / PWA 入口（App 内不显示） */}
      {!Capacitor.isNativePlatform() && (
        <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
          <Button block fill="outline" onClick={downloadApp}>
            下载 Android App
          </Button>
          {deferredPrompt && (
            <div style={{ marginTop: 12 }}>
              <Button block fill="none" onClick={installPwa}>
                安装到桌面（PWA）
              </Button>
            </div>
          )}
          {isIOS && (
            <div className="text-secondary" style={{ fontSize: 12, textAlign: 'center', marginTop: 12 }}>
              iOS 添加到主屏幕：Safari 点「分享」→「添加到主屏幕」
            </div>
          )}
        </div>
      )}
    </div>
  );
}
