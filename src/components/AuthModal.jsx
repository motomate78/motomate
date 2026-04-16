import React, { useState, useEffect } from 'react';
import { X, Loader2, Mail, Lock } from 'lucide-react';
import { apiClient } from '../apiClient';

const AuthModal = ({ isOpen, onClose, onLogin, onRegister, isPWA }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('yandex'); // yandex | vk | email
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const path = window.location.pathname;
    
    if (code) {
      if (path.includes('/auth/vk/callback')) {
        handleVkCallback(code);
      } else {
        handleYandexCallback(code);
      }
    }
  }, []);

  if (!isOpen) return null;

  const handleYandexLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Yandex OAuth configuration
      const clientId = import.meta.env.VITE_YANDEX_CLIENT_ID;
      if (!clientId) {
        throw new Error('Не задан VITE_YANDEX_CLIENT_ID в .env');
      }
      const redirectUri = encodeURIComponent(window.location.origin + '/auth/yandex/callback');
      const authUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`;
      
      // Redirect to Yandex OAuth
      window.location.href = authUrl;
    } catch (err) {
      setError(err?.message || 'Не удалось начать вход через Яндекс ID');
      setLoading(false);
    }
  };

  const handleYandexCallback = async (code) => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiClient.yandexAuth(code);
      
      if (data.token) {
        localStorage.setItem('userId', data.user.id);
        onLogin();
        onClose();
      }
    } catch (err) {
      setError(err?.message || 'Не удалось авторизоваться через Яндекс ID');
    } finally {
      setLoading(false);
    }
  };

  const handleVkLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      const clientId = import.meta.env.VITE_VK_CLIENT_ID;
      if (!clientId) throw new Error('Не задан VITE_VK_CLIENT_ID в .env');

      const redirectUri = encodeURIComponent(window.location.origin + '/auth/vk/callback');
      const authUrl = `https://oauth.vk.com/authorize?client_id=${clientId}&display=page&redirect_uri=${redirectUri}&scope=email&response_type=code&v=5.199`;
      window.location.href = authUrl;
    } catch (err) {
      setError(err?.message || 'Не удалось начать вход через VK');
      setLoading(false);
    }
  };

  const handleVkCallback = async (code) => {
    try {
      setLoading(true);
      setError(null);
      const redirectUri = window.location.origin + '/auth/vk/callback';
      const data = await apiClient.vkAuth(code, redirectUri);
      if (data.token) {
        localStorage.setItem('userId', data.user.id);
        onLogin();
        onClose();
      }
    } catch (err) {
      setError(err?.message || 'Не удалось авторизоваться через VK');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.emailLogin(email.trim(), password);
      if (data?.token) {
        localStorage.setItem('userId', data.user.id);
        onLogin();
        onClose();
      }
    } catch (err) {
      setError(err?.message || 'Не удалось войти по email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      {/* Backdrop - PWA cannot close */}
      {!isPWA && (
        <div 
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          onClick={onClose}
        />
      )}

      <div className="relative w-full max-w-md rounded-[32px] shadow-2xl border border-white/10 overflow-hidden bg-black/60 backdrop-blur-2xl">
        {/* Close button */}
        {!isPWA && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-all z-10"
          >
            <X size={20} />
          </button>
        )}

        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-black italic uppercase tracking-tight">
              МотоЗнакомства
            </h2>
            <p className="text-zinc-400 text-sm mt-2">
              Вход в приложение
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs text-center mb-6">
              {error}
            </div>
          )}

          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode('yandex')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${mode === 'yandex' ? 'bg-white text-black border-white' : 'bg-white/5 text-zinc-400 border-white/10'}`}>Яндекс</button>
            <button onClick={() => setMode('vk')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${mode === 'vk' ? 'bg-white text-black border-white' : 'bg-white/5 text-zinc-400 border-white/10'}`}>VK</button>
            <button onClick={() => setMode('email')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${mode === 'email' ? 'bg-white text-black border-white' : 'bg-white/5 text-zinc-400 border-white/10'}`}>Почта</button>
          </div>

          {mode === 'yandex' && (
            <button
              onClick={handleYandexLogin}
              disabled={loading}
              className="w-full bg-white text-black hover:bg-zinc-200 disabled:bg-white/60 font-bold py-4 rounded-[24px] shadow-[0_20px_40px_-15px_rgba(255,255,255,0.08)] transition-all active:scale-[0.98] flex items-center justify-center gap-3 mb-3"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : 'Войти через Яндекс ID'}
            </button>
          )}

          {mode === 'vk' && (
            <button
              onClick={handleVkLogin}
              disabled={loading}
              className="w-full bg-[#0077FF] hover:bg-[#0077FF]/90 disabled:bg-[#0077FF]/60 text-white font-bold py-4 rounded-[24px] transition-all active:scale-[0.98] mb-3"
            >
              Войти через VK ID
            </button>
          )}

          {mode === 'email' && (
            <div className="space-y-3 mb-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-3 flex items-center gap-2">
                  <Mail size={14} /> Почта
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-3 flex items-center gap-2">
                  <Lock size={14} /> Пароль
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors"
                />
              </div>
              <button
                onClick={handleEmailLogin}
                disabled={loading || !email.trim() || !password}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:bg-orange-600/40 text-white font-bold py-4 rounded-[24px] transition-all active:scale-[0.98]"
              >
                {loading ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Войти'}
              </button>
              <button
                onClick={onRegister}
                className="w-full text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Нет аккаунта? <span className="text-orange-500 font-bold">Зарегистрироваться</span>
              </button>
            </div>
          )}

          <p className="text-[11px] text-zinc-500 mt-4 leading-relaxed">
            Мы используем Яндекс ID для безопасного входа. Токен хранится на устройстве и передаётся на наш бэкенд.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
