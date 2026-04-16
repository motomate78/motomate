import React, { useState, useRef, useEffect } from 'react';
import AuthModal from './components/AuthModal';
import RegistrationModal from './components/RegistrationModal';
import MainApp from './components/MainApp';
import { Mail, Phone, MessageCircle, Send, FileText, ShieldCheck } from 'lucide-react';

import { apiClient } from './apiClient';

// Обработка ChunkLoadError для принудительной перезагрузки с очисткой кэша
const forceReload = () => {
  console.warn('Forcing hard reload to clear cache');
  // Очищаем все кэши
  if ('caches' in window) {
    caches.keys().then(cacheNames => {
      cacheNames.forEach(cacheName => {
        caches.delete(cacheName);
      });
    });
  }
  // Перезагружаем с принудительной очисткой кэша
  window.location.reload(true);
};

window.addEventListener('error', (event) => {
  const errorMsg = event.message || '';
  if (errorMsg.includes('Loading chunk') ||
      errorMsg.includes('Failed to fetch dynamically imported') ||
      errorMsg.includes('dynamically imported module')) {
    console.warn('Chunk load error detected:', errorMsg);
    forceReload();
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const errorMsg = event.reason?.message || event.reason || '';
  if (errorMsg.includes('Loading chunk') ||
      errorMsg.includes('Failed to fetch dynamically imported') ||
      errorMsg.includes('dynamically imported module')) {
    console.warn('Chunk load error in promise:', errorMsg);
    forceReload();
  }
});

function App() {
  // Определяем, запущено ли приложение как PWA
  const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                 window.navigator.standalone ||
                 document.referrer.includes('android-app://');

  // Состояния
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const howItWorksRef = useRef(null);
  
  // Логика для открытия/закрытия окна
  const handleModalClose = () => {
    if (!isPWA) {
      setIsAuthModalOpen(false);
    }
  };

  // Handle successful login
  const handleLogin = () => {
    setIsLoggedIn(true);
    setIsAuthModalOpen(false);
    setIsRegistrationModalOpen(false);
  };

  // Handle successful registration
  const handleRegister = () => {
    setIsLoggedIn(true);
    setIsRegistrationModalOpen(false);
    setIsAuthModalOpen(false);
  };

  // Open registration modal
  const openRegistrationModal = () => {
    setIsRegistrationModalOpen(true);
    setIsAuthModalOpen(false);
  };

  // Open login modal
  const openLoginModal = () => {
    setIsAuthModalOpen(true);
    setIsRegistrationModalOpen(false);
  };

  useEffect(() => {
    let mounted = true;
    
    // Handle logout URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const isLogout = urlParams.get('logout') === 'true';
    
    if (isLogout) {
      // Clear all auth data
      localStorage.removeItem('motomate_token');
      localStorage.removeItem('userId');
      localStorage.removeItem('userData');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('userImages');
      // Clear user cache keys
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('users_') || key.startsWith('chat_') || key.startsWith('events_')) {
          localStorage.removeItem(key);
        }
      });
      // Remove logout param from URL
      window.history.replaceState({}, document.title, window.location.origin);
      // Set logged out state
      if (mounted) {
        setIsLoggedIn(false);
        setIsAuthModalOpen(true);
        setIsLoading(false);
      }
      return () => {
        mounted = false;
      };
    }
    
    // Очистка старых ключей Supabase и инициализация для локальных тестов
    const cleanLegacyStorage = () => {
      const legacyKeys = [
        'supabase.auth.token', 
        'sb-ikztmdltejodcgxgwzbq-auth-token',
        'supabase.auth.expires_at',
        'userEmail'
      ];
      legacyKeys.forEach(key => localStorage.removeItem(key));
      
      // Локальный мок‑логин отключён: в MVP используем реальную сессию (Яндекс ID → JWT).
    };
    cleanLegacyStorage();
    
    // Проверяем сессии асинхронно, но быстро
    const checkSession = async () => {
      try {
        // Check token in localStorage
        const token = localStorage.getItem('motomate_token');
        const userId = localStorage.getItem('userId');
        const storedUserData = localStorage.getItem('userData');
        
        if (token && userId) {
          // Быстрый вход по мок‑токену отключён для MVP/прода
          
          // For real auth, verify profile via API
          try {
            const profile = await apiClient.getProfile();
            if (mounted) {
              setUserData(profile);
              setIsLoggedIn(true);
            }
          } catch (error) {
            console.error('Profile fetch failed:', error);
            // Token is invalid, remove it
            localStorage.removeItem('motomate_token');
            localStorage.removeItem('userId');
            localStorage.removeItem('userData');
            if (mounted) {
              setIsLoggedIn(false);
              if (isPWA) {
                setIsAuthModalOpen(true);
              }
            }
          }
        } else {
          // No token, show auth modal
          if (mounted) {
            setIsLoggedIn(false);
            if (isPWA) {
              setIsAuthModalOpen(true);
            }
          }
        }
        
        if (mounted) {
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Session check error:', error);
        if (mounted) {
          setIsLoading(false);
          setIsLoggedIn(false);
          if (isPWA) {
            setIsAuthModalOpen(true);
          }
        }
      }
    };

    // Проверка cookies
    const cookiesAccepted = localStorage.getItem('cookiesAccepted');
    if (!cookiesAccepted && mounted) {
      setTimeout(() => setShowCookies(true), 1000);
    }

    // Запускаем проверку сессии
    checkSession();

    return () => {
      mounted = false;
    };
  }, [isPWA]);

  // Показываем загрузочный экран во время проверки сессии
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-400 text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  // Если залогинены — показываем основное приложение
  if (isLoggedIn) {
    return <MainApp />;
  }

  return (
    <div className="min-h-screen bg-[#000000] text-white font-sans antialiased selection:bg-orange-500 selection:text-white">
      
      {/* Фоновое свечение */}
      <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-orange-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Лендинг только не в PWA */}
      {!isPWA && (
        <div className="transition-opacity duration-300">
          {/* Навигация */}
          <nav className="fixed top-0 w-full z-40 backdrop-blur-2xl bg-black/40 border-b border-white/[0.05] px-4 md:px-0">
            <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
              <div className="text-xl font-bold tracking-tighter italic uppercase">
                МОТО<span className="text-orange-500 font-black">ЗНАКОМСТВА</span>
              </div>
              <button 
                onClick={() => setIsAuthModalOpen(true)}
                className="text-sm font-semibold bg-white text-black px-6 py-2 rounded-full hover:bg-zinc-200 transition-all active:scale-95"
              >
                Войти
              </button>
            </div>
          </nav>

          {/* Hero Section */}
          <main className="relative pt-32 pb-20 px-4 md:px-6 max-w-6xl mx-auto scroll-smooth">
            <section className="text-center flex flex-col items-center">
              
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-[13px] font-medium text-zinc-400 mb-10 shadow-inner">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                </span>
                Сообщество в твоем городе
              </div>

              <h1 className="text-5xl md:text-[84px] font-bold tracking-tight mb-8 leading-[1.05]">
                <span className="bg-gradient-to-b from-white via-white to-zinc-400 bg-clip-text text-transparent">
                  Твоя дорога <br />
                  начинается здесь
                </span>
              </h1>

              <p className="text-zinc-400 text-lg md:text-xl max-w-xl mb-12 leading-relaxed font-light">
                Найди того, с кем не захочется тормозить. Прокати мечту или встреть своего пилота.
              </p>

              <div className="flex flex-col sm:flex-row gap-5 w-full justify-center items-center">
                <button 
                  onClick={() => setIsAuthModalOpen(true)}
                  className="w-full sm:w-auto bg-orange-600 hover:bg-orange-500 text-white px-12 py-5 rounded-[24px] font-bold text-lg shadow-[0_20px_40px_-15px_rgba(234,88,12,0.3)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  Попробовать сейчас
                </button>
                <button 
                  onClick={() => howItWorksRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="w-full sm:w-auto backdrop-blur-md bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.1] px-12 py-5 rounded-[24px] font-bold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  Узнать больше
                </button>
              </div>
            </section>

            {/* Блок "Как это работает?" */}
            <section ref={howItWorksRef} className="mt-32 py-20">
              <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tight text-center mb-16">
                Как это <span className="text-orange-500">работает?</span>
              </h2>
              <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                <div className="text-center p-8 bg-white/[0.02] border border-white/5 rounded-[32px]">
                  <div className="w-16 h-16 bg-orange-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-3xl font-black text-orange-500">1</span>
                  </div>
                  <h3 className="text-xl font-bold uppercase italic mb-4">Создай профиль</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">Расскажи о себе, загрузи фото и укажи свой город. Чем больше информации, тем лучше мэтчи.</p>
                </div>
                <div className="text-center p-8 bg-white/[0.02] border border-white/5 rounded-[32px]">
                  <div className="w-16 h-16 bg-orange-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-3xl font-black text-orange-500">2</span>
                  </div>
                  <h3 className="text-xl font-bold uppercase italic mb-4">Ищи и свайпай</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">Просматривай анкеты байкеров в твоем городе. Лайкай тех, с кем хочешь прокатиться.</p>
                </div>
                <div className="text-center p-8 bg-white/[0.02] border border-white/5 rounded-[32px]">
                  <div className="w-16 h-16 bg-orange-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-3xl font-black text-orange-500">3</span>
                  </div>
                  <h3 className="text-xl font-bold uppercase italic mb-4">Встречайся и катайся</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">При взаимном лайке начинается общение. Договаривайся о прохватах и создавай события.</p>
                </div>
              </div>
            </section>

            {/* Галерея */}
            <section className="mt-32 py-20">
              <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tight text-center mb-16">
                Живи <span className="text-orange-500">свободно</span>
              </h2>
              <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="group relative aspect-[16/9] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02] hover:border-orange-500/30 transition-all duration-300 hover:scale-[1.02]">
                    <img 
                      src="/gallery/event.jpg" 
                      alt="Мото-события"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-white text-sm font-bold uppercase tracking-wider">Мероприятия</p>
                        <p className="text-white/80 text-xs">Катайся вместе</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="group relative aspect-[16/9] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02] hover:border-orange-500/30 transition-all duration-300 hover:scale-[1.02]">
                    <img 
                      src="/gallery/prohvat.jpg" 
                      alt="Прохват"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-white text-sm font-bold uppercase tracking-wider">Прохваты</p>
                        <p className="text-white/80 text-xs">Драйв по ночному городу</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="group relative aspect-[16/9] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02] hover:border-orange-500/30 transition-all duration-300 hover:scale-[1.02]">
                    <img 
                      src="/gallery/night.jpg" 
                      alt="Ночные катания"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-white text-sm font-bold uppercase tracking-wider">Ночь</p>
                        <p className="text-white/80 text-xs">Рев моторов под звездами</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="group relative aspect-[16/9] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02] hover:border-orange-500/30 transition-all duration-300 hover:scale-[1.02]">
                    <img 
                      src="/gallery/love.jpg" 
                      alt="Байкерские знакомства"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-white text-sm font-bold uppercase tracking-wider">Любовь и скорость</p>
                        <p className="text-white/80 text-sm">Найди того, кто разделит твою дорогу</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Блоки для разных категорий */}
            <section className="mt-32 py-20 space-y-12">
              {/* ДЛЯ ПИЛОТОВ */}
              <div className="max-w-5xl mx-auto p-12 bg-gradient-to-br from-orange-600/10 to-transparent border border-orange-500/20 rounded-[32px]">
                <h2 className="text-3xl md:text-4xl font-black italic uppercase tracking-tight mb-6">
                  ТВОЙ БАЙК — <span className="text-orange-500">ТВОИ ПРАВИЛА</span>
                </h2>
                <p className="text-zinc-300 text-lg leading-relaxed">
                  Хватит возить пустой номер. Найди ту, что разделит с тобой закат на смотровой и доверит тебе свою дорогу. Прокати мечту на своем байке.
                </p>
              </div>

              {/* ДЛЯ ДЕВУШЕК */}
              <div className="max-w-5xl mx-auto p-12 bg-gradient-to-br from-pink-600/10 to-transparent border border-pink-500/20 rounded-[32px]">
                <h2 className="text-3xl md:text-4xl font-black italic uppercase tracking-tight mb-6">
                  НАЙДИ СВОЙ <span className="text-pink-500">ДРАЙВ</span>
                </h2>
                <p className="text-zinc-300 text-lg leading-relaxed">
                  Мечтаешь о скорости, но нет своего байка? Найди пилота, с которым не страшно заложить поворот. Твой идеальный парень на байке уже прогревает мотор.
                </p>
              </div>

              {/* ПРИКЛЮЧЕНИЯ */}
              <div className="max-w-5xl mx-auto p-12 bg-gradient-to-br from-blue-600/10 to-transparent border border-blue-500/20 rounded-[32px]">
                <h2 className="text-3xl md:text-4xl font-black italic uppercase tracking-tight mb-6">
                  БОЛЬШЕ ЧЕМ <span className="text-blue-500">ЗНАКОМСТВА</span>
                </h2>
                <p className="text-zinc-300 text-lg leading-relaxed">
                  Создавай групповые прохваты, ищи компанию для дальняков или просто друзей по интересам. Мы здесь ради свободы и рева моторов.
                </p>
              </div>
            </section>
          </main>

          {/* Контакты + Футер */}
          <section className="mt-32 py-20 border-t border-white/5 bg-[#000000]">
            <div className="max-w-6xl mx-auto px-6 space-y-10">
              <h2 className="text-3xl md:text-4xl font-black italic uppercase tracking-tight text-center">
                <span className="text-orange-500">Связь</span> и поддержка
              </h2>

              <div className="backdrop-blur-lg bg-white/5 border border-white/10 rounded-[28px] p-8 md:p-10">
                <div className="grid md:grid-cols-3 gap-10">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wide text-sm">
                      <Mail size={16} className="text-orange-500" />
                      <span>Почта</span>
                    </div>
                    <a
                      href="mailto:info@motoznakomstva.ru"
                      className="text-zinc-300 hover:text-[#f97315] transition-colors duration-300"
                    >
                      info@motoznakomstva.ru
                    </a>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wide text-sm">
                      <Phone size={16} className="text-orange-500" />
                      <span>Телефон</span>
                    </div>
                    <a
                      href="tel:+79991234567"
                      className="text-zinc-300 hover:text-[#f97315] transition-colors duration-300"
                    >
                      +7 (999) 123-45-67
                    </a>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wide text-sm">
                      <MessageCircle size={16} className="text-orange-500" />
                      <span>Соцсети</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <a
                        href="#"
                        aria-label="VK"
                        className="w-10 h-10 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:text-[#f97315] hover:border-[#f97315]/40 transition-all duration-300 flex items-center justify-center"
                      >
                        <MessageCircle size={18} />
                      </a>
                      <a
                        href="#"
                        aria-label="Telegram"
                        className="w-10 h-10 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:text-[#f97315] hover:border-[#f97315]/40 transition-all duration-300 flex items-center justify-center"
                      >
                        <Send size={18} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <footer className="pt-6 border-t border-white/10 space-y-3">
                <div className="text-xs text-gray-500 text-center">
                  © 2026 Мотознакомства
                </div>
                <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
                  <a href="#" className="inline-flex items-center gap-1.5 hover:text-[#f97315] transition-colors duration-300">
                    <ShieldCheck size={13} />
                    <span>Политика</span>
                  </a>
                  <a href="#" className="inline-flex items-center gap-1.5 hover:text-[#f97315] transition-colors duration-300">
                    <FileText size={13} />
                    <span>Соглашение</span>
                  </a>
                </div>
                <div className="text-xs text-gray-500 text-center">
                  ИП Фамилия И.О., ОГРНИП: 000000000000000, ИНН: 000000000000.
                </div>
              </footer>
            </div>
          </section>
        </div>
      )}

      {/* Модальное окно авторизации (поверх всего в PWA) */}
      {isAuthModalOpen && (
        <AuthModal 
          isOpen={isAuthModalOpen} 
          onClose={handleModalClose} 
          onLogin={handleLogin}
          onRegister={openRegistrationModal}
          isPWA={isPWA}
        />
      )}

      {/* Registration Modal */}
      {isRegistrationModalOpen && (
        <RegistrationModal 
          isOpen={isRegistrationModalOpen} 
          onClose={() => setIsRegistrationModalOpen(false)}
          onRegister={handleRegister}
          isPWA={isPWA}
        />
      )}

      {/* Куки окно */}
      {showCookies && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom duration-300">
          <div className="max-w-4xl mx-auto bg-[#1c1c1e]/95 border border-white/10 rounded-[32px] p-6 shadow-2xl backdrop-blur-2xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-sm font-bold uppercase italic mb-2">Мы используем куки</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Мы используем файлы cookie для улучшения работы сайта и персонализации контента. 
                  Продолжая использовать сайт, вы соглашаетесь с нашей{' '}
                  <a href="#" className="text-orange-500 hover:underline">политикой конфиденциальности</a>.
                </p>
              </div>
              <div className="flex gap-3 shrink-0">
                <button
                  onClick={() => {
                    localStorage.setItem('cookiesAccepted', 'necessary');
                    setShowCookies(false);
                  }}
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase hover:bg-white/10 transition-all"
                >
                  Принять только необходимое
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('cookiesAccepted', 'all');
                    setShowCookies(false);
                  }}
                  className="px-4 py-2 bg-orange-600 rounded-xl text-xs font-bold uppercase hover:bg-orange-500 transition-all"
                >
                  Принять все
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
