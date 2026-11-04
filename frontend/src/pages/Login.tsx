import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Toast } from 'antd-mobile';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/auth';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);

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
    </div>
  );
}
