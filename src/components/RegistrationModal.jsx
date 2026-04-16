import React, { useState } from 'react';
import { X, Loader2, Mail, Lock, Check } from 'lucide-react';
import { apiClient } from '../apiClient';
import LegalModal from './LegalModal';

const RegistrationModal = ({ isOpen, onClose, onRegister, isPWA }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  
  // Согласия с документами
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedCookies, setAgreedCookies] = useState(false);
  const [agreedLicense, setAgreedLicense] = useState(false);
  
  // Modal для просмотра документов
  const [legalModal, setLegalModal] = useState(null);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      {/* Backdrop */}
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
          <div className="text-center">
            <h3 className="text-xl font-black italic uppercase tracking-tight">Регистрация</h3>
            <p className="text-zinc-400 text-sm mt-2">Можно зарегистрироваться по почте или через соцсети.</p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs text-center mt-4">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-3">
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
                <Lock size={14} /> Пароль (минимум 6 символов)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-500 uppercase ml-3 flex items-center gap-2">
                <Lock size={14} /> Повтор пароля
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
            </div>

            {/* Согласия с документами */}
            <div className="mt-6 space-y-3 border-t border-white/10 pt-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedPrivacy}
                  onChange={(e) => setAgreedPrivacy(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-orange-500 cursor-pointer"
                />
                <span className="text-xs text-zinc-300">
                  Я согласен с{' '}
                  <button
                    type="button"
                    onClick={() => setLegalModal('privacy')}
                    className="text-orange-500 hover:text-orange-400 underline"
                  >
                    политикой конфиденциальности
                  </button>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedCookies}
                  onChange={(e) => setAgreedCookies(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-orange-500 cursor-pointer"
                />
                <span className="text-xs text-zinc-300">
                  Я согласен с{' '}
                  <button
                    type="button"
                    onClick={() => setLegalModal('cookies')}
                    className="text-orange-500 hover:text-orange-400 underline"
                  >
                    политикой использования cookie
                  </button>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedLicense}
                  onChange={(e) => setAgreedLicense(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-orange-500 cursor-pointer"
                />
                <span className="text-xs text-zinc-300">
                  Я согласен с{' '}
                  <button
                    type="button"
                    onClick={() => setLegalModal('license')}
                    className="text-orange-500 hover:text-orange-400 underline"
                  >
                    лицензионным соглашением
                  </button>
                </span>
              </label>
            </div>

            <button
              onClick={async () => {
                try {
                  setLoading(true);
                  setError(null);
                  if (!email.trim()) throw new Error('Укажите email');
                  if (password.length < 6) throw new Error('Пароль должен быть не короче 6 символов');
                  if (password !== confirm) throw new Error('Пароли не совпадают');
                  if (!agreedPrivacy) throw new Error('Примите политику конфиденциальности');
                  if (!agreedCookies) throw new Error('Примите политику использования cookie');
                  if (!agreedLicense) throw new Error('Примите лицензионное соглашение');

                  const data = await apiClient.emailRegister(email.trim(), password, {
                    agreed_privacy: agreedPrivacy,
                    agreed_cookies: agreedCookies,
                    agreed_license: agreedLicense,
                  });
                  localStorage.setItem('userId', data.user.id);
                  localStorage.setItem('motomate_token', data.token);
                  onRegister?.();
                  onClose?.();
                } catch (e) {
                  setError(e?.message || 'Не удалось зарегистрироваться');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading || !agreedPrivacy || !agreedCookies || !agreedLicense}
              className="w-full mt-4 bg-orange-600 hover:bg-orange-500 disabled:bg-orange-600/40 text-white font-bold py-4 rounded-[24px] transition-all active:scale-[0.98]"
            >
              {loading ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Создать аккаунт'}
            </button>
          </div>
        </div>
      </div>

      {/* Legal Documents Modal */}
      <LegalModal 
        isOpen={!!legalModal} 
        onClose={() => setLegalModal(null)} 
        docType={legalModal}
      />
    </div>
  );
};

export default RegistrationModal;
