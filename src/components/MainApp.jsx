import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { Search, Heart, MapPin, MessageCircle, User, X, Gauge, Music, Shield, Target, Edit3, Settings, LogOut, ChevronLeft, ChevronRight, ChevronDown, MessageSquare, Send, Camera, Navigation, Zap, Trash2, Ban, Image as ImageIcon, Plus, Calendar, Clock, MapPin as MapPinIcon, Smile, Database, Loader2, Check, CheckCheck, Info, ArrowRight, Maximize2, Minimize2 } from 'lucide-react';
import ApiManager from './ApiManager';
import { apiClient } from '../apiClient';
import { userService, eventService, groupChatService, compressImage } from '../apiService';
import { useGeolocation } from '../hooks/useGeolocation';
import { useAddressSuggest } from '../hooks/useAddressSuggest';
import { CityAutocomplete } from './CityAutocomplete';
import { AddressAutocomplete } from './AddressAutocomplete';
import PrivacySettings from './PrivacySettings';
const EventsMap = React.lazy(() => import('./EventsMap'));

const isValidAdultAge = (age) => Number.isInteger(age) && age >= 18;

const isRequiredProfileFilled = (profile) => {
  if (!profile) return false;
  const cityText = String(profile.city || '').trim();
  return Boolean(profile.name?.trim())
    && isValidAdultAge(Number(profile.age))
    && cityText.length > 2
    && Boolean(profile.gender);
};

// Компонент для автоподстановки адресов/городов через Yandex Suggest
const SuggestAutocomplete = ({ value, onChange, onSelect, placeholder, userCity = '', type = 'geo' }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const yandexApiKey = String(import.meta.env.VITE_YANDEX_API_KEY || '').trim();

  const fetchSuggestions = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const searchText = userCity ? `${userCity}, ${query}` : query;
      // Используем бэкенд прокси /api/geo/suggest (избегаем CORS)
      const response = await fetch(
        `/api/geo/suggest?text=${encodeURIComponent(searchText)}&type=${encodeURIComponent(type)}&results=6&lang=ru_RU`
      );

      if (!response.ok) {
        setSuggestions([]);
        return;
      }

      const data = await response.json();
      const normalized = (data.results || []).map((item) => {
        const displayText = item.text || '';
        const coords = item.coords || null;
        return { text: displayText, coords };
      }).filter((item) => item.text);

      setSuggestions(normalized);
    } catch (error) {
      console.error('Ошибка загрузки подсказок:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [type, userCity]);

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(newValue);
    }, 300);
    setShowSuggestions(true);
  };

  const handleSuggestionClick = (suggestion) => {
    onChange(suggestion.text);
    onSelect?.(suggestion);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleClickOutside = (e) => {
    if (inputRef.current && !inputRef.current.contains(e.target)) {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  if (!suggestEnabled) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-sm outline-none text-white placeholder-zinc-500"
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="relative" ref={inputRef}>
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        className="flex-1 bg-transparent text-sm outline-none text-white placeholder-zinc-500"
        placeholder={placeholder}
        onFocus={() => setShowSuggestions(true)}
      />
      
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
          {loading ? (
            <div className="p-3 text-zinc-500 text-sm">Загрузка...</div>
          ) : (
            suggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors first:rounded-t-xl last:rounded-b-xl"
              >
                {suggestion.text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// Leaflet/OpenStreetMap удалены — используем Яндекс.Карты

const MainApp = () => {
  // --- СОСТОЯНИЯ ПРИЛОЖЕНИЯ ---
  // const [isLoading, setIsLoading] = useState(false); // Не показываем загрузку
  // const [isNewUser, setIsNewUser] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

  const formatEventDate = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long' }).format(d);
  };

  const formatEventTime = (value) => {
    if (!value) return '';
    // backend may send ISO date string for "time"
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
    }
    // if already "HH:MM"
    return String(value).slice(0, 5);
  };

  const formatChatTime = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
  };

  // const isProfileComplete = (u) => {
  //   return isRequiredProfileFilled(u);
  // };

  // Запрос разрешения на уведомления
  const requestNotificationPermission = async () => {
    // Проверяем поддержку уведомлений
    if (!('Notification' in window)) {
      console.log('Браузер не поддерживает уведомления');
      return;
    }

    console.log('Текущий статус разрешений:', Notification.permission);

    try {
      let permission;
      
      // Если разрешение еще не запрашивалось, запрашиваем
      if (Notification.permission === 'default') {
        permission = await Notification.requestPermission();
        console.log('Получено разрешение:', permission);
      } else {
        permission = Notification.permission;
        console.log('Используем существующее разрешение:', permission);
      }

      // Если разрешение получено, регистрируем Service Worker и подписываемся
      if (permission === 'granted') {
        console.log('Разрешение на уведомления получено');
        
        // Регистрируем Service Worker для push уведомлений
        if ('serviceWorker' in navigator) {
          try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker зарегистрирован:', registration);
          } catch (error) {
            console.error('Ошибка регистрации Service Worker:', error);
          }
        }
        
        // Подписываемся на push уведомления
        // await subscribeToPushNotifications(); // TEMPORARILY DISABLED
      } else if (permission === 'denied') {
        console.log('Пользователь запретил уведомления');
        // Можно показать информационное сообщение о важности уведомлений
      } else {
        console.log('Unknown permission status:', permission);
      }
    } catch (error) {
      console.error('Ошибка запроса разрешения на уведомления:', error);
    }
  };

  // Отправка push уведомления через новый API
  const sendPushNotification = async (title, options = {}) => {
    try {
      const result = await apiClient.sendPush({
        title,
        body: options.body || 'Новое уведомление',
        icon: options.icon || '/favicons/android-chrome-192x192.png',
        tag: options.tag || 'motopara-notification'
      });
      console.log('Push notification result:', result);
      return result;
    } catch (error) {
      console.error('Error sending push notification:', error);
      return { success: false, error: error.message };
    }
  };

  // Отправка push уведомления
  const sendNotification = (title, options = {}) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, {
        body: options.body || 'Новое уведомление',
        icon: '/favicons/android-chrome-192x192.png',
        badge: '/favicons/favicon-32x32.png',
        vibrate: [100, 50, 100],
        tag: 'motopara-notification',
        requireInteraction: false,
        ...options
      });
      
      // Автоматически закрываем через 5 секунд
      setTimeout(() => {
        notification.close();
      }, 5000);
      
      return notification;
    }
    return null;
  };

  // Подписка на push уведомления
  // const subscribeToPushNotifications = async () => {
  //   if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
  //     console.log('Браузер не поддерживает push уведомления');
  //     return;
  //   }

  //   // Получаем userId из localStorage, если userData еще не загружен
  //   const userId = userData?.id || localStorage.getItem('userId');
    
  //   if (!userId) {

  //     try {
  //       const registration = await navigator.serviceWorker.ready;
  //       console.log('Service Worker готов, подписываемся на push уведомления...');
      
  //       const subscription = await registration.pushManager.subscribe({
  //         userVisibleOnly: true,
  //         applicationServerKey: urlB64ToUint8Array('BJjpNkIbnYXoftgL755_wE_IeooVx-pN-Pl_nZM7UpQ_TpUl1tNACNdPBr3q5MqzfdFxoLcW8aIQq8TE8a_ddbE')
  //       });

  //       console.log('Подписка получена:', subscription);

  //       // Сохраняем подписку в базу данных через новый API
  //       try {
  //         // await apiClient.subscribePush(subscription); // TEMPORARILY DISABLED
  //         console.log('Подписка на push уведомления отключена');
  //       } catch (error) {
  //         console.error('Ошибка сохранения подписки:', error);
  //       }
  //     } catch (error) {
  //       console.error('Ошибка подписки на push уведомления:', error);
  //       // Если пользователь ранее отменил подписку, пытаемся создать новую
  //       if (error.name === 'AbortError' || error.message.includes('subscription')) {
  //         console.log('Пробуем создать новую подписку...');
  //         try {
  //           const registration = await navigator.serviceWorker.ready;
  //           // Сначала удаляем старую подписку если есть
  //           const existingSubscription = await registration.pushManager.getSubscription();
  //           if (existingSubscription) {
  //             await existingSubscription.unsubscribe();
  //           }
  //           // Создаем новую подписку
  //           // await subscribeToPushNotifications(); // TEMPORARILY DISABLED
  //         } catch (retryError) {
  //           console.error('Повторная попытка подписки не удалась:', retryError);
  //         }
  //       }
  //     }
  //   };
  // };

  // Вспомогательная функция для конвертации VAPID ключа
  // const urlB64ToUint8Array = (base64String) => {
  //   const padding = '='.repeat((4 - base64String.length % 4) % 4);
  //   const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  //   const rawData = window.atob(base64);
  //   const outputArray = new Uint8Array(rawData.length);
  //   
  //   for (let i = 0; i < rawData.length; ++i) {
  //     outputArray[i] = rawData.charCodeAt(i);
  //   }
  //   return outputArray;
  // };
  const formatMessageTime = (createdAt) => {
    if (!createdAt) return '';
    
    const messageDate = new Date(createdAt);
    const time = messageDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    return time;
  };

  // Функция форматирования даты для разделителя
  const formatDateForSeparator = (createdAt) => {
    if (!createdAt) return '';
    
    const messageDate = new Date(createdAt);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDay = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());
    
    if (messageDay.getTime() === today.getTime()) {
      return 'Сегодня';
    } else if (messageDay.getTime() === today.getTime() - 24 * 60 * 60 * 1000) {
      return 'Вчера';
    } else {
      return messageDate.toLocaleDateString('ru-RU', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long' 
      });
    }
  };

  // Группировка сообщений по датам
  const groupMessagesByDate = (messages) => {
    if (!messages || messages.length === 0) return [];
    
    const grouped = [];
    let currentDate = null;
    
    messages.forEach((message) => {
      const messageDate = new Date(message.created_at);
      const dateKey = messageDate.toDateString();
      
      // Если это новая дата, добавляем разделитель
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        grouped.push({
          type: 'separator',
          date: formatDateForSeparator(message.created_at),
          created_at: message.created_at
        });
      }
      
      // Добавляем само сообщение
      grouped.push({
        type: 'message',
        ...message
      });
    });
    
    return grouped;
  };

  // Функция геокодирования адреса через Yandex API
  // const geocodeAddress = async (address) => {
  //   if (!address) return null;
  //   
  //   try {
  //     const yandexApiKey = String(import.meta.env.VITE_YANDEX_API_KEY || '').trim();
  //     if (!yandexApiKey) {
  //       console.warn('Yandex API key not configured');
  //       return null;
  //     }

  //     const response = await fetch(
  //       `https://geocode-maps.yandex.ru/1.x/?apikey=${yandexApiKey}&geocode=${encodeURIComponent(address)}&format=json&lang=ru_RU`
  //     );

  //     if (!response.ok) {
  //       console.warn('Geocoding request failed');
  //       return null;
  //     }

  //     const data = await response.json();
  //     const point = data.response.GeoObjectCollection.featureMember[0]?.GeoObject.Point?.pos;
  //     
  //     if (point) {
  //       const [lng, lat] = point.split(' ').map(Number);
  //       return { lat, lng };
  //     }
  //   } catch (error) {
  //     console.error('Geocoding error:', error);
  //   }
  //   
  //   return null;
  // };

  // const getProfileImage = (user) => {
  //   if (user.images && user.images.length > 0) return user.images[0];
  //   if (user.image) return user.image;
  //   return DEFAULT_AVATAR;
  // };

  const [selectedImage, setSelectedImage] = useState(null); // Для модального окна просмотра всех фото (чат, галерея, профиль)
  const [imageContext, setImageContext] = useState({ type: null, images: [], currentIndex: 0 }); // Контекст просмотра фото
  // const [onlineUsers, setOnlineUsers] = useState(new Set());

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({
            lat: latitude,
            lng: longitude
          });
          // Сохраняем координаты в userData для отображения на карте
          setUserData(prev => prev ? { ...prev, latitude, longitude } : prev);
          // Автоцентрируем карту при первом запуске
          try {
            setActiveTab((t) => t); // no-op; map component reads userLocation
          } catch {
            console.log('Auto-center map: no-op completed');
          }
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    }
  }, []);

  // Online status tracking - disabled for new API
  // TODO: Implement online status tracking with new backend

  useEffect(() => {
          if (didRunSessionCheckRef.current) return;
          didRunSessionCheckRef.current = true;

          const checkSession = async () => {
              console.log('Checking session...');
              
              // Добавляем таймаут для предотвращения бесконечной загрузки
              const timeout = setTimeout(() => {
                  console.error('Profile loading timeout - showing error');
                  setError('Превышено время загрузки профиля. Попробуйте обновить страницу.');
              }, 10000); // 10 секунд
              
              try {
                  const token = localStorage.getItem('motomate_token');
                  console.log('Token found:', !!token);
                  
                  if (token) {
                      const userId = localStorage.getItem('userId');
                      
                      // Set token in apiClient instance
                      apiClient.setToken(token);
                      
                      // Request notification permission (don't block loading)
                      requestNotificationPermission();
                      
                      // Load fresh profile data
                      console.log('Loading user profile...');
                      let user = null;
                      try {
                        user = await apiClient.getProfile();
                        console.log('User data loaded:', !!user);
                        clearTimeout(timeout);
                        
                        if (user) {
                            console.log('User profile data loaded successfully');
                        }
                      } catch (error) {
                        console.error('Error loading user profile:', error);
                        
                        // Handle 401/403 errors (session expired)
                        if (error.status === 401 || error.status === 403 || error.message.includes('401') || error.message.includes('403')) {
                          console.log('Token invalid, clearing session...');
                          apiClient.removeToken();
                          localStorage.removeItem('motomate_token');
                          localStorage.removeItem('userId');
                          // Не вызываем window.location.reload() сразу, даем системе шанс восстановиться или показать вход
                        }
                        clearTimeout(timeout);
                      }
                  
                  // Если профиля нет, создаем его с пустыми полями
                  if (!user) {
                     const defaultProfile = {
                       id: userId,
                       email: localStorage.getItem('userEmail') || '',
                       name: null,
                       age: null,
                       city: "Moscow",
                       address: null,
                       bike: "",
                       gender: "male",
                       has_bike: false,
                       about: null,
                       image: null,
                       images: [], // Пустой массив для галереи
                       has_seen_welcome: false,
                       created_at: new Date().toISOString()
                     };
                     
                     setUserData(defaultProfile);
                     
                     // TEMP: disable auto-save to avoid request storm (save only by button)
                     // try {
                     //   await apiClient.updateProfile(defaultProfile);
                     // } catch (insertError) {
                     //   console.error('Error creating user profile:', insertError);
                     // }
                  }
                    
                  if (user) {
                    console.log('Setting userData and userImages...');
                    
                    // Parse images if it's a JSON string
                    let parsedImages = user.images;
                    if (typeof parsedImages === 'string') {
                      try {
                        parsedImages = JSON.parse(parsedImages);
                      } catch (e) {
                        parsedImages = [];
                      }
                    }
                    
                    setUserData(user);
                    
                    // Загружаем фото из Image table
                    try {
                      const imagesRes = await fetch('/api/users/profile/images', {
                        headers: { 'Authorization': `Bearer ${token}` }
                      });
                      if (imagesRes.ok) {
                        const imagesData = await imagesRes.json();
                        // imagesData теперь просто массив, не { images: ... }
                        const imageUrls = (Array.isArray(imagesData) ? imagesData : []).map(img => img.url);
                        setUserImages(imageUrls);
                        localStorage.setItem('userImages', JSON.stringify(imageUrls));
                      } else {
                        setUserImages([]);
                        localStorage.setItem('userImages', JSON.stringify([]));
                      }
                    } catch (err) {
                      console.error('Error loading gallery images:', err);
                      setUserImages([]);
                      localStorage.setItem('userImages', JSON.stringify([]));
                    }
                    
                    // Повторно пытаемся подписаться на push уведомления после загрузки userData
                    if (Notification.permission === 'granted') {
                      console.log('Повторная попытка подписки на push уведомления после загрузке профиля');
                      // subscribeToPushNotifications(); // TEMPORARILY DISABLED
                    }
                    
                    // Проверяем, новый ли это пользователь (пустой профиль)
                    // Показываем приветствие только если профиль действительно пустой и пользователь еще не видел приветствие
                    console.log('DEBUG: userData before WelcomeModal check:', user);
                    const isEmptyProfile = !isRequiredProfileFilled(user);
                    
                    if (isEmptyProfile && !user.has_seen_welcome) {
                      // setIsNewUser(true);
                      setShowWelcomeModal(true);
                      
                      // TEMP: disable auto-save to avoid request storm (save only by button)
                      // try {
                      //   await apiClient.updateProfile({ has_seen_welcome: true });
                      // } catch (error) {
                      //   console.error('Error updating has_seen_welcome:', error);
                      // }
                    }
                  }
              } else {
                  console.log('No session found');
                  clearTimeout(timeout);
              }
              } catch (error) {
                  console.error('Error in checkSession:', error);
                  clearTimeout(timeout);
              }
          };
          checkSession();
        }, []);

  useEffect(() => {
    const handleApiError = ({ status, message }) => {
      // Игнорируем ошибки сессии при начальной загрузке, чтобы избежать бесконечных редиректов
      if (status === 401 || status === 403) {
        console.warn('API Session error (ignored to prevent loop):', status);
        // Не вызываем setError, чтобы не блокировать интерфейс при фоновой проверке
        return;
      }
      if (status >= 500) {
        setError(message || 'Ошибка сервера. Повторите попытку позже.');
      }
    };
    const handleSessionExpired = () => {
      setError('Сессия истекла. Пожалуйста, войдите снова.');
      setTimeout(() => window.location.reload(), 1200);
    };

    apiClient.setErrorHandler(handleApiError);
    // window.addEventListener('motomate:sessionExpired', handleSessionExpired);
    return () => {
      apiClient.setErrorHandler(null);
      // window.removeEventListener('motomate:sessionExpired', handleSessionExpired);
    };
  }, []);

  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('search');
  const [showSettings, setShowSettings] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [matchData, setMatchData] = useState(null);
  const [selectedChat, setSelectedChat] = useState(null);
  const [hasNewMatchNotification, setHasNewMatchNotification] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // const [isTyping, setIsTyping] = useState(false);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const typingTimeoutRef = useRef(null);
  const [contextMenuMessageId, setContextMenuMessageId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const messagesEndRef = useRef(null);
  const [swipedChatId, setSwipedChatId] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showEventErrors, setShowEventErrors] = useState(false);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [viewingProfileLoading, setViewingProfileLoading] = useState(false);
  
  // Settings States
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Данные из API
  const [events, setEvents] = useState([]);
  const [bikers, setBikers] = useState([]);
  const [chats, setChats] = useState([]);
  const [newMatches, setNewMatches] = useState([]);
  
  // Состояния для групповых чатов
  const [selectedGroupChat, setSelectedGroupChat] = useState(null);
  const [groupChatMessageInput, setGroupChatMessageInput] = useState('');
  const [showGroupChatEmojiPicker, setShowGroupChatEmojiPicker] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);

  const [newEvent, setNewEvent] = useState({ title: '', description: '', date: '', time: '', address: '', link: '', latitude: null, longitude: null });
  // const fileInputRef = useRef(null);
  const profileInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const didRunSessionCheckRef = useRef(false);

  // Данные пользователя
  const [userData, setUserData] = useState(null);
  const profileCompleted = isRequiredProfileFilled(userData);
  const isProfileLocked = Boolean(userData) && !profileCompleted;
  const isEditingProcess = showSettings || showAppSettings;
  const shouldEnforceProfileLock = isProfileLocked && !isEditingProcess;

  // Геолокация
  const yandexApiKey = String(import.meta.env.VITE_YANDEX_API_KEY || '').trim();
  const { city: detectedCity, coordinates: detectedCoordinates, loading: geoLoading, error: geoError, requestGeolocation } = useGeolocation(yandexApiKey, false);
  const { searchAddresses: suggestAddresses } = useAddressSuggest(yandexApiKey);

  useEffect(() => {
    const cityText = String(userData?.city || '').trim();
    if (cityText.length > 0) return;
    if (userData?.latitude == null && userData?.longitude == null) return;
    setUserData((prev) => (prev ? { ...prev, latitude: null, longitude: null } : prev));
  }, [userData?.city, userData?.latitude, userData?.longitude]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [dismissedUserIds, setDismissedUserIds] = useState(() => new Set());
  // const cities = ["Москва", "Санкт-Петербург", "Сочи", "Краснодар"]; // Removed hardcoded cities

  // Состояния для свайпов в стиле Tinder
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [exitDirection, setExitDirection] = useState(null);
  const cardRef = useRef(null);
  const profileScrollRef = useRef(null); // Ref for resetting scroll

  // Фильтруем анкеты: используем данные из API
  const matchedIds = useMemo(() => chats.map(chat => {
      // Ищем ID собеседника (не свой ID)
      const currentUserId = localStorage.getItem('userId');
      if (chat.participant_1_id == currentUserId) return chat.participant_2_id;
      if (chat.participant_2_id == currentUserId) return chat.participant_1_id;
      return null;
  }).filter(id => id), [chats]);

  const filteredBikers = useMemo(() => {
    const currentUserId = localStorage.getItem('userId');
    return bikers.filter(b => 
      !matchedIds.includes(b.id) && 
      b.id !== currentUserId &&
      b.city === userData?.city &&
      !dismissedUserIds.has(b.id)
    );
  }, [bikers, matchedIds, userData?.city, dismissedUserIds]);

  // Безопасное получение currentBiker с проверкой на существование
  const currentBiker = filteredBikers.length > 0 && currentIndex >= 0 && currentIndex < filteredBikers.length 
    ? filteredBikers[currentIndex] 
    : null;
  const profileSaveDisabled = !isRequiredProfileFilled(userData);
  const cityBikers = useMemo(
    () => bikers.filter((b) => b.city === userData?.city),
    [bikers, userData?.city]
  );
  const cityEvents = useMemo(
    () => events.filter((e) => e.city === userData?.city),
    [events, userData?.city]
  );
  const mapUserData = useMemo(
    () => (userData ? {
      ...userData,
      latitude: userLocation?.lat ?? userData?.latitude,
      longitude: userLocation?.lng ?? userData?.longitude,
    } : null),
    [userData, userLocation?.lat, userLocation?.lng]
  );

  const [userImages, setUserImages] = useState(() => {
    // Инициализация из localStorage при первом рендере
    try {
      const saved = localStorage.getItem('userImages');
      if (saved) {
        const images = JSON.parse(saved);
        if (Array.isArray(images) && images.length > 0) {
          return images;
        }
      }
    } catch (e) {
      console.error('Ошибка загрузки галереи при инициализации:', e);
    }
    return [];
  });

  // Set up global callbacks for real-time updates
  useEffect(() => {
    window.newMatchesCallback = (matches) => {
      setNewMatches(prev => [...matches, ...prev]);
      setHasNewMatchNotification(true);
    };
    
    return () => {
      window.newMatchesCallback = null;
    };
  }, []);

  // Sync selectedChat with chats for real-time updates
  useEffect(() => {
    if (selectedChat) {
      const updatedChat = chats.find(c => c.id === selectedChat.id);
      if (updatedChat) {
        // Preserve local state like scroll position if needed, but for now just update messages
        // We only want to update if messages count changed or last message changed to avoid unnecessary re-renders
        if (updatedChat.messages.length !== selectedChat.messages.length || 
            updatedChat.lastMessage !== selectedChat.lastMessage ||
            updatedChat.isPartnerTyping !== selectedChat.isPartnerTyping) {
          setSelectedChat(prev => ({
            ...prev,
            ...updatedChat,
            messages: updatedChat.messages
          }));
        }
      }
    }
  }, [chats, selectedChat]);

  // Subscribe to typing indicators
  useEffect(() => {
    if (!selectedChat?.id) return;
    
    // Reset typing state when chat changes
    setIsPartnerTyping(false);

    const unsubscribe = window.apiManager.subscribeToTyping(selectedChat.id, () => {
      setIsPartnerTyping(true);
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        setIsPartnerTyping(false);
      }, 3000);
    });
    
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [selectedChat?.id]);

  useEffect(() => {
    const handleNewMessage = (event) => {
      const { chatId, message } = event.detail || {};
      if (!chatId || !message) return;
      if (message.sender_id === localStorage.getItem('userId')) return;

      const isSameChatOpened = activeTab === 'chats' && selectedChat?.id === chatId;
      if (isSameChatOpened) return;

      const chat = chats.find((item) => item.id === chatId);
      const toastId = `${chatId}_${message.id || Date.now()}`;
      const toastPayload = {
        id: toastId,
        title: chat?.name || 'Новое сообщение',
        text: message.text?.trim() || (message.type === 'image' ? 'Фото' : 'Новое сообщение'),
        avatar: chat?.image || DEFAULT_AVATAR,
      };

      setToasts((prev) => [...prev.slice(-2), toastPayload]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 4200);
    };

    window.addEventListener('motomate:newMessage', handleNewMessage);
    return () => window.removeEventListener('motomate:newMessage', handleNewMessage);
  }, [activeTab, chats, selectedChat?.id]);

  // Обновление индекса при изменении фильтров
  useEffect(() => {
    setCurrentIndex(0);
    setCurrentImageIndex(0);
  }, [userData?.city, userData?.gender]);

  const handleNext = () => {
    if (filteredBikers.length > 0) {
      setExitDirection('left');
      setTimeout(() => {
          setCurrentIndex((prev) => prev + 1);
          setCurrentImageIndex(0);
          setDragOffset({ x: 0, y: 0 });
          setExitDirection(null);
          if (profileScrollRef.current) {
            profileScrollRef.current.scrollTop = 0;
          }
      }, 300);
    }
  };

  const handleLike = async () => {
    if (!currentBiker) return;
    const likedUser = currentBiker;
    setDismissedUserIds((prev) => {
      const next = new Set(prev);
      next.add(likedUser.id);
      return next;
    });
    
    setExitDirection('right');
    
    setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        setCurrentImageIndex(0);
        setDragOffset({ x: 0, y: 0 });
        setExitDirection(null);
        if (profileScrollRef.current) profileScrollRef.current.scrollTop = 0;
    }, 300);

    try {
      if (window.apiManager && likedUser.id) {
        const result = await window.apiManager.recordLike(likedUser.id);
        
        if (result.isMatch) {
          const newChat = result.chat;
          const chatData = {
            id: newChat.id,
            name: likedUser.name,
            image: likedUser.images[0] || DEFAULT_AVATAR,
            lastMessage: 'Это мэтч! Начните общение первым',
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            online: true,
            unreadCount: 0,
            messages: [],
            partnerId: likedUser.id,
            canSendMessage: true // Оба участника могут писать
          };
          setChats(prev => [chatData, ...prev]);
          
          setMatchData(likedUser);
          setHasNewMatchNotification(true);
          // Добавляем chatId для правильной идентификации
          setNewMatches(prev => [{...likedUser, chatId: newChat.id, isNew: true}, ...prev]);
          
          // Отправляем уведомление о новом мэтче
          sendNotification('🏍️ Новый мэтч!', {
            body: `У вас новый мэтч: ${likedUser.name}, ${likedUser.age} лет`,
            icon: likedUser.images?.[0] || DEFAULT_AVATAR,
            tag: 'new-match'
          });
          
          // Отправляем push уведомление
          sendPushNotification('🏍️ Новый мэтч!', {
            body: `У вас новый мэтч: ${likedUser.name}, ${likedUser.age} лет`,
            icon: likedUser.images?.[0] || DEFAULT_AVATAR,
            tag: 'new-match'
          });
        }
      }
    } catch (err) {
      console.error('Error in handleLike:', err);
    }
  };

  const handleDislike = async () => {
    if (!currentBiker) return;
    const dislikedUser = currentBiker;
    setDismissedUserIds((prev) => {
      const next = new Set(prev);
      next.add(dislikedUser.id);
      return next;
    });
    
    setExitDirection('left');
    
    setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        setCurrentImageIndex(0);
        setDragOffset({ x: 0, y: 0 });
        setExitDirection(null);
        if (profileScrollRef.current) profileScrollRef.current.scrollTop = 0;
    }, 300);

    try {
      if (window.apiManager && dislikedUser.id) {
        await window.apiManager.recordDislike(dislikedUser.id);
      }
    } catch (err) {
      console.error('Error in handleDislike:', err);
    }
  };

  // Обработчики свайпов в стиле Tinder
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    setDragStart({ x: touch.clientX, y: touch.clientY });
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStart.x;
    const deltaY = touch.clientY - dragStart.y;
    
    // Если свайп больше по горизонтали, чем по вертикали - это свайп влево/вправо
    // Игнорируем если свайп в основном вертикальный (скролл)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setDragOffset({ x: deltaX, y: 0 });
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    
    const threshold = 100; // Минимальное расстояние для свайпа
    
    if (Math.abs(dragOffset.x) > threshold) {
      if (dragOffset.x > 0) {
        // Свайп вправо - лайк
        handleLike();
      } else {
        // Свайп влево - дизлайк
        handleDislike();
      }
    }
    
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
  };

  // Обработчики для мыши (для десктопа)
  const handleMouseDown = (e) => {
    setDragStart({ x: e.clientX, y: e.clientY });
    setIsDragging(true);
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    
    // Если свайп больше по горизонтали, чем по вертикали - это свайп влево/вправо
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setDragOffset({ x: deltaX, y: 0 });
    }
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    
    const threshold = 100;
    
    if (Math.abs(dragOffset.x) > threshold) {
      if (dragOffset.x > 0) {
        handleLike();
      } else {
        handleDislike();
      }
    }
    
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
  };

  // Закрываем мэтч при смене вкладки
  useEffect(() => {
    if (activeTab !== 'search') {
      setMatchData(null);
    }
  }, [activeTab]);

  useEffect(() => {
    if (shouldEnforceProfileLock) {
      setShowWelcomeModal(true);
      if (activeTab !== 'profile') {
        setActiveTab('profile');
      }
    }
  }, [activeTab, shouldEnforceProfileLock]);

  const switchImage = (e) => {
    if (!currentBiker) return;
    
    // Ensure images is an array
    let images = currentBiker.images;
    if (typeof images === 'string') {
      try {
        images = JSON.parse(images);
      } catch (e) {
        images = [];
      }
    }
    
    // Если у пользователя нет изображений, не переключаем
    if (!images || images.length === 0) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width / 2) {
      if (currentImageIndex < images.length - 1) {
        setCurrentImageIndex(prev => prev + 1);
      } else {
        setCurrentImageIndex(0);
      }
    } else {
      if (currentImageIndex > 0) {
        setCurrentImageIndex(prev => prev - 1);
      } else {
        setCurrentImageIndex(currentBiker.images.length - 1);
      }
    }
  };

  // Функции для навигации по фото в модальном окне
  const navigateImage = useCallback((direction) => {
    if (!selectedImage || !imageContext.images.length) return;
    
    const currentIndex = imageContext.images.indexOf(selectedImage);
    if (currentIndex === -1) return;
    
    let newIndex;
    if (direction === 'next') {
      newIndex = currentIndex < imageContext.images.length - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : imageContext.images.length - 1;
    }
    
    setSelectedImage(imageContext.images[newIndex]);
    setImageContext(prev => ({ ...prev, currentIndex: newIndex }));
  }, [selectedImage, imageContext.images]);

  // Обработчик клавиатуры для модального окна
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedImage) return;
      
      if (e.key === 'Escape') {
        setSelectedImage(null);
      } else if (e.key === 'ArrowLeft') {
        navigateImage('prev');
      } else if (e.key === 'ArrowRight') {
        navigateImage('next');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
 }, [selectedImage, imageContext, navigateImage]);

  const openChat = async (chat) => {
    setSelectedChat(chat);
    setActiveTab('chats');
    const updatedChats = chats.map(c => c.id === chat.id ? {...c, unreadCount: 0, isNew: false} : c);
    setChats(updatedChats);
    // last seen for unread dot
    try {
      localStorage.setItem(`chat_last_seen_${chat.id}`, String(Date.now()));
    } catch {
      console.log('Failed to save last seen timestamp');
    }
    // Убираем из новых мэтчей
    setNewMatches(prev => prev.map(m => m.chatId === chat.id ? {...m, isNew: false} : m));
    
    // Mark as read in backend
    if (window.apiManager?.markAsRead) {
      await window.apiManager.markAsRead(chat.id);
    }

    // Load full message history on open
    try {
      const messages = await apiClient.getChatMessages(chat.id);
      setSelectedChat(prev => prev ? ({ ...prev, messages }) : prev);
      setChats(prev => prev.map(c => c.id === chat.id ? ({ ...c, messages }) : c));
    } catch (e) {
      console.error('Ошибка загрузки сообщений чата:', e);
    }
  };

  const deleteChat = (chatId) => {
    setChats(chats.filter(c => c.id !== chatId));
    if (selectedChat?.id === chatId) {
      setSelectedChat(null);
    }
  };

  const blockUser = (chatId) => {
    // В будущем здесь будет логика блокировки
    deleteChat(chatId);
  };

  const updateGallery = async (newImages) => {
    try {
      console.log('Updating gallery locally (server save on button):', newImages);
      setUserImages(newImages);
      localStorage.setItem('userImages', JSON.stringify(newImages));
      setUserData((prev) => ({ ...prev, images: newImages }));
    } catch (err) {
      console.error('Error updating gallery locally:', err);
      alert('Не удалось обновить галерею. Попробуйте еще раз.');
    }
  };

  const deleteGalleryImageByUrl = async (imageUrl) => {
    const token = localStorage.getItem('motomate_token');
    if (!token || !imageUrl) return;
    try {
      const listRes = await fetch('/api/users/profile/images', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listRes.ok) return;
      const list = await listRes.json();
      const target = (Array.isArray(list) ? list : []).find((item) => item?.url === imageUrl);
      if (!target?.id) return;
      await fetch(`/api/users/profile/images/${target.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error('Error deleting gallery image metadata:', error);
    }
  };

  const handleEmailUpdate = async () => {
    if (!newEmail || !newEmail.includes('@')) {
        alert('Введите корректный email');
        return;
    }
    if (!emailCurrentPassword) {
      alert('Введите текущий пароль');
      return;
    }
    try {
        setIsUpdatingEmail(true);
        const data = await apiClient.updateEmail(newEmail.trim(), emailCurrentPassword);
        setUserData((prev) => ({ ...prev, email: data?.user?.email || newEmail.trim() }));
        localStorage.setItem('userEmail', data?.user?.email || newEmail.trim());
        alert('Email успешно обновлен');
        setIsEditingEmail(false);
        setNewEmail('');
        setEmailCurrentPassword('');
    } catch (err) {
        console.error('Ошибка смены почты:', err);
        alert('Ошибка: ' + err.message);
    } finally {
        setIsUpdatingEmail(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!passwordCurrentPassword) {
      alert('Введите текущий пароль');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      alert('Новый пароль должен быть не короче 6 символов');
      return;
    }
    try {
      setIsUpdatingPassword(true);
      await apiClient.updatePassword(passwordCurrentPassword, newPassword);
      alert('Пароль успешно обновлен');
      setIsEditingPassword(false);
      setPasswordCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      console.error('Ошибка смены пароля:', err);
      alert('Ошибка: ' + err.message);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    const firstConfirm = window.confirm('Удалить аккаунт без возможности восстановления?');
    if (!firstConfirm) return;
    const secondConfirm = window.confirm('Это действие удалит все ваши данные и фотографии. Продолжить?');
    if (!secondConfirm) return;

    try {
      setIsLoggingOut(true);
      await apiClient.deleteMyAccount();
      apiClient.removeToken();
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = `${window.location.origin}?accountDeleted=true&t=${Date.now()}`;
    } catch (err) {
      console.error('Ошибка удаления аккаунта:', err);
      alert(`Не удалось удалить аккаунт: ${err.message}`);
      setIsLoggingOut(false);
    }
  };

  const handleImageUpload = async (e, isProfile = false, isGallery = false) => {
    if (!e.target.files || e.target.files.length === 0) return;

    try {
        setIsUploading(true);
        const userId = localStorage.getItem('userId');
        
        if (!userId) {
            throw new Error('Пользователь не найден');
        }
        
        if (isProfile) {
            const file = e.target.files[0];
            console.log('Uploading avatar:', file.name);
            console.log('Original file size:', (file.size / 1024 / 1024).toFixed(2) + ' MB');
            
            try {
                // Показываем пользователю что происходит сжатие
                console.log('Сжимаем изображение...');
                
                // Сохраняем старый аватар ПЕРЕД загрузкой нового
                const oldAvatarUrl = userData?.image;
                
                const imageUrl = await userService.uploadAvatar(userId, file, null); // Передаем null, чтобы НЕ удалять старый из S3
                console.log('Avatar uploaded:', imageUrl);
                
                // Обновляем состояние аватара
                setUserData(prev => ({...prev, image: imageUrl}));
                
                // Принудительно обновляем компонент для сброса кэша изображения
                setTimeout(() => {
                    setUserData(prev => ({...prev}));
                }, 100);
                
                // Добавляем старый аватар в галерею, если он был
                if (oldAvatarUrl) {
                    setUserImages(prevImages => {
                      if (!prevImages.includes(oldAvatarUrl)) {
                        const updated = [oldAvatarUrl, ...prevImages];
                        localStorage.setItem('userImages', JSON.stringify(updated));
                        return updated;
                      }
                      return prevImages;
                    });
                    
                    // Также сохраняем метаданные старого аватара в БД как обычное фото галереи
                    try {
                      const token = localStorage.getItem('motomate_token');
                      await fetch('/api/users/profile/images', {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${token}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ url: oldAvatarUrl })
                      });
                    } catch (dbErr) {
                      console.warn('Failed to save old avatar metadata to gallery db:', dbErr);
                    }
                }
                
                // Новый аватар тоже добавляем в галерею
                setUserImages(prevImages => {
                  if (!prevImages.includes(imageUrl)) {
                    const updated = [imageUrl, ...prevImages];
                    localStorage.setItem('userImages', JSON.stringify(updated));
                    return updated;
                  }
                  return prevImages;
                });
            } catch (uploadError) {
                console.error('Avatar upload error:', uploadError);
                alert('Avatar upload error: ' + JSON.stringify(uploadError));
                throw uploadError;
            }
            
        } else if (isGallery) {
            const file = e.target.files[0];
            console.log('Uploading gallery image:', file.name);
            console.log('Original gallery file size:', (file.size / 1024 / 1024).toFixed(2) + ' MB');
            
            try {
                // Показываем пользователю что происходит сжатие
                console.log('Сжимаем изображение для галереи...');
                
                const imageUrl = await userService.uploadGalleryImage(userId, file);
                console.log('Gallery image uploaded:', imageUrl);
                
                // Добавляем фото в галерею
                await updateGallery([...userImages, imageUrl]);
            } catch (uploadError) {
                console.error('Gallery upload error:', uploadError);
                alert('Gallery upload error: ' + JSON.stringify(uploadError));
                throw uploadError;
            }
            
        } else {
            // Chat images (support multiple)
            const files = Array.from(e.target.files);
            console.log(`Processing ${files.length} chat images...`);
            
            for (const file of files) {
                try {
                    console.log('Processing chat image:', file.name);
                    console.log('Original file size:', (file.size / 1024 / 1024).toFixed(2) + ' MB');
                    
                    // Сжимаем изображение для чата
                    const compressedFile = await compressImage(file, 800, 800, 0.7);
                    console.log('Compressed file size:', (compressedFile.size / 1024 / 1024).toFixed(2) + ' MB');
                    
                    const fileExt = 'jpg'; // Всегда сохраняем как JPG после сжатия
                    const fileName = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                    const imageDataUrl = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = (evt) => resolve(evt.target?.result);
                      reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения'));
                      reader.readAsDataURL(compressedFile);
                    });

                    const { url: publicUrl } = await apiClient.uploadImage(imageDataUrl, fileName);

                    console.log('Chat image uploaded successfully:', publicUrl);

                    if (selectedChat && window.apiManager) {
                        await window.apiManager.sendMessage(selectedChat.id, '', 'image', publicUrl);
                        console.log('Chat image message sent successfully');
                    } else {
                        console.error('No selected chat or apiManager available');
                    }
                } catch (imageError) {
                    console.error('Error processing chat image:', imageError);
                    setError('Ошибка загрузки фото в чат: ' + imageError.message);
                    // Продолжаем обработку других файлов даже если один не удался
                }
            }
        }
    } catch (err) {
        console.error('Error uploading image:', err);
        setError('Ошибка загрузки фото: ' + err.message);
        // Показываем alert для лучшей обратной связи
        alert('Ошибка загрузки фото: ' + err.message);
    } finally {
        setIsUploading(false); // Завершаем загрузку в любом случае
        // Очищаем значение input для возможности повторной загрузки того же файла
        e.target.value = '';
    }
  };

  const createEvent = async () => {
    if (newEvent.title && newEvent.date && newEvent.time) {
      try {
        const userId = localStorage.getItem('userId');
        if (!userId) {
          alert("Ошибка: Пользователь не найден");
          return;
        }

        const eventData = {
          title: newEvent.title.trim(),
          description: newEvent.description?.trim() || null,
          city: userData.city,
          date: newEvent.date,
          time: newEvent.time,
          address: newEvent.address?.trim() || null,
          link: newEvent.link?.trim() || null,
          latitude: typeof newEvent.latitude === 'number' ? newEvent.latitude : null,
          longitude: typeof newEvent.longitude === 'number' ? newEvent.longitude : null,
        };
        
        console.log('🚀 Вызываем eventService.createEvent с данными:', eventData);
        await eventService.createEvent(eventData);
        
        setNewEvent({ title: '', description: '', date: '', time: '', address: '', link: '', latitude: null, longitude: null });
        setShowEventModal(false);
        
        if (window.apiManager && window.apiManager.loadEvents) {
          window.apiManager.loadEvents();
        }
      } catch (err) {
        console.error('Error creating event:', err);
        alert('Ошибка при создании события: ' + err.message);
      }
    }
  };

  // Функции для групповых чатов
  const openGroupChatFromChats = async (chat) => {
    try {
      // const userId = localStorage.getItem('userId');
      
      // Загружаем данные чата
      const groupChatData = await groupChatService.getGroupChat(chat.group_chat_id);
      const messages = await groupChatService.getGroupChatMessages(chat.group_chat_id);
      
      setSelectedGroupChat({
        ...groupChatData,
        messages: messages
      });
    } catch (err) {
      console.error('Error opening group chat from chats:', err);
      alert('Ошибка открытия чата: ' + err.message);
    }
  };

  const joinGroupChat = async (groupChatId) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) {
        alert('Ошибка: Пользователь не найден');
        return;
      }

      // Проверяем, не состоит ли пользователь уже в чате
      const existingParticipant = await groupChatService.isUserInGroupChat(groupChatId, userId);
      if (existingParticipant) {
        alert('Вы уже состоите в этом чате');
        return;
      }

      // Присоединяемся к чату
      await groupChatService.joinGroupChat(groupChatId, userId);
      
      // Загружаем информацию о групповом чате
      const groupChatData = await groupChatService.getGroupChat(groupChatId);
      setSelectedGroupChat(groupChatData);
      
      // Добавляем групповой чат в список чатов
      const formattedGroupChat = {
        id: groupChatData.id,
        name: groupChatData.name,
        created_at: groupChatData.created_at,
        is_group_chat: true,
        group_chat_id: groupChatId,
        // Добавляем данные для отображения
        image: null, // у групповых чатов нет аватара
        partnerId: null, // у групповых чатов нет партнера
        unreadCount: 0
      };
      
      console.log('Добавляем групповой чат в список:', formattedGroupChat);
      setChats(prevChats => {
        const updatedChats = [formattedGroupChat, ...prevChats];
        console.log('Обновленный список чатов:', updatedChats);
        return updatedChats;
      });
      
      alert('Вы присоединились к чату события!');
    } catch (err) {
      console.error('Error joining group chat:', err);
      alert('Ошибка при присоединении к чату: ' + err.message);
    }
  };

  const sendGroupMessage = async () => {
    if (!groupChatMessageInput.trim() || !selectedGroupChat) return;

    try {
      const userId = localStorage.getItem('userId');
      const messageData = {
        sender_id: userId,
        text: groupChatMessageInput.trim(),
        type: 'text'
      };

      const message = await groupChatService.sendGroupMessage(selectedGroupChat.id, messageData);
      
      // Добавляем сообщение в локальное состояние
      setSelectedGroupChat(prev => ({
        ...prev,
        messages: [...(prev.messages || []), message]
      }));

      setGroupChatMessageInput('');
    } catch (err) {
      console.error('Error sending group message:', err);
      alert('Ошибка отправки сообщения: ' + err.message);
    }
  };

  const openGroupChat = async (event) => {
    if (!event.group_chat_id) {
      alert('Чат для этого события еще не создан');
      return;
    }

    try {
      const userId = localStorage.getItem('userId');
      
      // Проверяем, состоит ли пользователь в чате
      const isParticipant = await groupChatService.isUserInGroupChat(event.group_chat_id, userId);
      
      if (!isParticipant) {
        // Если пользователь не в чате, показываем подтверждение
        if (!confirm('Хотите присоединиться к чату этого события?')) {
          return;
        }
        await joinGroupChat(event.group_chat_id);
      }
      
      // Загружаем данные чата
      const groupChatData = await groupChatService.getGroupChat(event.group_chat_id);
      const messages = await groupChatService.getGroupChatMessages(event.group_chat_id);
      
      // Переключаем на вкладку "Чаты" и открываем групповой чат
      setActiveTab('chats');
      setSelectedGroupChat({
        ...groupChatData,
        messages: messages
      });
    } catch (err) {
      console.error('Error opening group chat:', err);
      alert('Ошибка открытия чата: ' + err.message);
    }
  };

  // const clearTestData = async () => {
  //   try {
  //       // This function would need to be implemented in the new backend
  //       alert('Функция очистки тестовых данных временно отключена');
  //   } catch (err) {
  //       console.error('Error clearing test data:', err);
  //       alert('Не удалось удалить данные: ' + err.message);
  //   }
  // };

  const deleteEvent = async (e, eventId) => {
    e.stopPropagation();
    
    // Safety check if eventId is passed correctly
    const idToDelete = typeof eventId === 'object' ? eventId.id : eventId;
    
    if (!idToDelete) {
        console.error('Invalid event ID:', eventId);
        alert('Ошибка: Неверный ID события');
        return;
    }

    if (!confirm('Вы уверены, что хотите удалить это событие?')) return;
    
    try {
      console.log('Deleting event:', idToDelete);
      await apiClient.deleteEvent(idToDelete);
      
      // Optimistic update
      setEvents(prev => prev.filter(e => e.id !== idToDelete));
      
      if (window.apiManager && window.apiManager.loadEvents) {
        window.apiManager.loadEvents();
      }
    } catch (err) {
      console.error('Error deleting event:', err);
      alert('Ошибка при удалении события: ' + err.message);
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (window.confirm('Удалить сообщение?')) {
      try {
        await window.apiManager.deleteMessage(messageId);
        // Remove from local state immediately
        if (selectedChat) {
          const updatedMessages = selectedChat.messages.filter(m => m.id !== messageId);
          const updatedChat = { ...selectedChat, messages: updatedMessages };
          setSelectedChat(updatedChat);
          setChats(prevChats => prevChats.map(c => c.id === selectedChat.id ? updatedChat : c));
        }
      } catch (e) {
        console.error('Error deleting message:', e);
      }
    }
    setContextMenuMessageId(null);
  };

  const handleOpenProfile = async (partnerId) => {
    try {
      setViewingProfileLoading(true);
      const data = await apiClient.getUserById(partnerId);
      
       let interests = data.interests;
       if (typeof interests === 'string') {
         try { interests = JSON.parse(interests); } catch (e) {
          console.log('Failed to parse interests JSON:', e);
        }
       }
       if (!interests || !Array.isArray(interests)) {
          interests = [
            { id: 'style', label: 'Стиль', value: data.temp || 'Спокойный', icon: 'Gauge' },
            { id: 'music', label: 'Музыка', value: data.music || 'Рок', icon: 'Music' },
            { id: 'equip', label: 'Экип', value: data.equip || 'Только шлем', icon: 'Shield' },
            { id: 'goal', label: 'Цель', value: data.goal || 'Только поездки', icon: 'Target' }
          ];
       }
       
       const interestsWithIcons = interests.map(i => ({
         ...i,
         icon: i.icon === 'Gauge' ? <Gauge size={14} /> :
               i.icon === 'Music' ? <Music size={14} /> :
               i.icon === 'Shield' ? <Shield size={14} /> :
               i.icon === 'Target' ? <Target size={14} /> :
               <Gauge size={14} />
       }));
       
       // Combine all images (avatar + gallery)
       let allImages = [];
       let parsedImages = data.images;
       
       // Parse images if it's a JSON string
       if (typeof parsedImages === 'string') {
         try {
           parsedImages = JSON.parse(parsedImages);
         } catch (e) {
           parsedImages = [];
         }
       }
       
       if (parsedImages && Array.isArray(parsedImages) && parsedImages.length > 0) {
           allImages = parsedImages;
       } else if (data.image) {
           allImages = [data.image];
       } else {
           allImages = [DEFAULT_AVATAR];
       }

       setViewingProfile({ 
         ...data, 
         interests: interestsWithIcons, 
         images: allImages
       });

    } catch (err) {
      console.error("Error fetching profile:", err);
      // alert("Не удалось загрузить профиль");
    } finally {
      setViewingProfileLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !selectedChat) return;

    // Проверяем, можно ли отправлять сообщения в этом чате
    // Для мэтчей оба участника могут писать, для других чатов тоже разрешаем
    const canSend = selectedChat.canSendMessage !== false;
    if (!canSend) {
      setError('Нельзя отправлять сообщения в этом чате');
      return;
    }

    try {
      // Send new message
      let sentMessage = null;
      if (window.apiManager) {
        sentMessage = await window.apiManager.sendMessage(selectedChat.id, messageInput.trim());
      }
      
      setMessageInput('');
      setShowEmojiPicker(false);

      const nowIso = new Date().toISOString();
      const lastText = messageInput.trim();

      // optimistic UI update for last message/time + move chat to top
      setChats((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== selectedChat.id) return c;
          const nextMessages = sentMessage ? [...(c.messages || []), sentMessage] : (c.messages || []);
          return {
            ...c,
            messages: nextMessages,
            lastMessage: lastText,
            time: formatChatTime(nowIso),
            last_message_time: nowIso,
          };
        });
        const idx = updated.findIndex((c) => c.id === selectedChat.id);
        if (idx <= 0) return updated;
        const [item] = updated.splice(idx, 1);
        return [item, ...updated];
      });
      
      // Прокрутка к новому сообщению
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Ошибка отправки сообщения');
    }
  };


  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedChat?.messages]);

  // Sync selectedChat with chats updates (real-time)
  useEffect(() => {
    const syncSelectedChat = async () => {
      if (selectedChat && chats.length > 0) {
        const updatedChat = chats.find(c => c.id === selectedChat.id);
        if (updatedChat) {
          const messagesChanged = JSON.stringify(updatedChat.messages) !== JSON.stringify(selectedChat.messages);
          
          if (messagesChanged) {
             setSelectedChat(() => ({
               ...updatedChat,
               // Preserve local state if needed, but usually we want fresh data
             }));
             
             // If new messages arrived while chat is open, mark them as read
             const hasUnread = updatedChat.messages.some(m => !m.is_read && m.sender === 'other');
             if (hasUnread && window.apiManager?.markAsRead) {
                await window.apiManager.markAsRead(updatedChat.id);
             }
          }
        }
      }
    };
    syncSelectedChat();
  }, [chats, selectedChat]);

  // Realtime message handler (socket.io → CustomEvent)
  useEffect(() => {
    const handler = (ev) => {
      const { chatId, message } = ev.detail || {};
      if (!chatId || !message) return;

      setChats((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== chatId) return c;
          const nextMessages = Array.isArray(c.messages) ? [...c.messages, message] : [message];
          const lastText = message.text || (message.type === 'image' ? 'Фото' : '—');
          const lastTimeIso = message.created_at || new Date().toISOString();
          const next = {
            ...c,
            messages: nextMessages,
            lastMessage: lastText,
            time: formatChatTime(lastTimeIso),
            last_message_time: lastTimeIso,
          };
          // unread dot if chat not open and message not mine
          const currentUserId = localStorage.getItem('userId');
          const isMine = message.sender_id === currentUserId;
          if (!isMine && (!selectedChat || selectedChat.id !== chatId)) {
            next.unreadCount = 1;
          }
          return next;
        });

        // move updated chat to top
        const idx = updated.findIndex((c) => c.id === chatId);
        if (idx > 0) {
          const [item] = updated.splice(idx, 1);
          updated.unshift(item);
        }
        return updated;
      });

      if (selectedChat?.id === chatId) {
        setSelectedChat((prev) => prev ? ({ ...prev, messages: Array.isArray(prev.messages) ? [...prev.messages, message] : [message] }) : prev);
      }
    };

    window.addEventListener('motomate:newMessage', handler);
    return () => window.removeEventListener('motomate:newMessage', handler);
  }, [selectedChat]);


  // Функция для загрузки полного профиля пользователя
  const loadUserProfile = async (userId) => {
    try {
      // Сначала ищем в bikers
      let userData = bikers.find(b => b.id === userId);
      
      // Если не найдено, загружаем из базы
      if (!userData) {
        userData = await userService.getUserById(userId);
      }
      
      return userData;
    } catch (error) {
      console.error('Error loading user profile:', error);
      return null;
    }
  };

  // Функция для открытия профиля пользователя
  const openUserProfile = async (userId) => {
    const userData = await loadUserProfile(userId);
    if (userData) {
      setMatchData(userData);
      setViewingProfile(true);
    }
  };

  // Обработка ошибок
  if (error) {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center p-6">
        <h2 className="text-2xl font-black uppercase italic mb-4 text-red-500">Ошибка</h2>
        <p className="text-zinc-400 mb-6 text-center">{error}</p>
        <button 
          onClick={() => {
            setError(null);
            window.location.reload();
          }}
          className="bg-orange-600 px-6 py-3 rounded-xl font-bold uppercase"
        >
          Перезагрузить
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 w-full h-full supports-[height:100dvh]:h-[100dvh] bg-black text-white flex flex-col overflow-hidden font-sans animate-in fade-in duration-500">
      
      {/* API Manager - works in background */}
      {userData && (
        <ApiManager 
          userData={userData}
          onUsersLoaded={setBikers}
          onChatsLoaded={setChats}
          onEventsLoaded={setEvents}
        />
      )}
      
      {!selectedChat && !viewingProfile && (
        <header className="sticky top-0 z-50 h-16 min-h-16 shrink-0 backdrop-blur-xl bg-black/90 border-b border-white/5 flex items-center justify-between px-6">
          <div className="text-lg font-black tracking-tighter italic uppercase">Мото<span className="text-orange-500">Знакомства</span></div>
          <button onClick={() => {setActiveTab('profile');}} className={`w-9 h-9 rounded-full border transition-all flex items-center justify-center overflow-hidden ${activeTab === 'profile' ? 'border-orange-500 bg-orange-500/10' : 'border-white/10 bg-white/5'}`}>
            {userData?.image ? (
              <img src={userData.image} className="w-full h-full object-cover" alt="Profile" />
            ) : (
              <User size={20} className={activeTab === 'profile' ? 'text-orange-500' : 'text-zinc-400'} />
            )}
          </button>
        </header>
      )}

      {/* Full Screen Image Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img 
            src={selectedImage} 
            className="max-w-full max-h-full object-contain rounded-lg"
            alt="Full screen"
          />
          <button 
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20"
          >
            <X size={24} />
          </button>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-full max-w-sm px-4 space-y-2 pointer-events-none">
          {toasts.map((toast) => (
            <div key={toast.id} className="bg-black/70 border border-white/10 backdrop-blur-2xl rounded-2xl p-3 shadow-2xl">
              <div className="flex items-center gap-3">
                <img src={toast.avatar} alt="" className="w-10 h-10 rounded-xl object-cover border border-white/10" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-white truncate">{toast.title}</p>
                  <p className="text-xs text-zinc-300 truncate">{toast.text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <main className="flex-1 relative overflow-hidden">
        
        {activeTab === 'search' && (
          <div className="h-full flex flex-col items-center justify-center relative overflow-hidden">
            {filteredBikers.length > 0 && currentBiker ? (
              <div className="w-full max-w-md h-full flex flex-col items-center px-4 py-2 space-y-3">
                {/* Glassmorphism контейнер с карточкой */}
                <article 
                  ref={cardRef}
                  className={`w-full rounded-[40px] overflow-hidden backdrop-blur-2xl bg-white/8 border border-white/20 shadow-2xl transition-all duration-300 flex-1 min-h-0 ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  } select-none`}
                  style={{
                    transform: exitDirection 
                        ? `translateX(${exitDirection === 'right' ? 1000 : -1000}px) rotate(${exitDirection === 'right' ? 20 : -20}deg)`
                        : `translateX(${dragOffset.x}px) rotate(${dragOffset.x * 0.1}deg)`,
                    opacity: exitDirection ? 0 : (isDragging ? 1 - Math.abs(dragOffset.x) / 500 : 1),
                    transition: exitDirection ? 'transform 0.3s ease-in-out, opacity 0.3s ease-in-out' : 'none'
                  }}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Внутренний контейнер с прокруткой */}
                  <div 
                    ref={profileScrollRef}
                    className="h-full flex flex-col overflow-y-auto"
                  >
                    {/* Изображение на весь окошко */}
                    <div 
                      className="relative w-full h-full shrink-0"
                      style={{ minHeight: '100%' }}
                      onClick={switchImage}
                    >
                      <img 
                        src={currentBiker.images[currentImageIndex] || currentBiker.images[0] || DEFAULT_AVATAR} 
                        className="absolute inset-0 w-full h-full object-cover z-10" 
                        alt="Biker" 
                        onError={(e) => {
                          e.target.src = DEFAULT_AVATAR;
                        }}
                      />

                      {/* Полоски индикатора изображений */}
                      <div className="absolute top-6 left-6 right-6 flex gap-1.5 z-30 pointer-events-none">
                        {currentBiker.images && currentBiker.images.length > 0 ? currentBiker.images.map((_, i) => (
                          <div key={i} className={`h-1 flex-1 rounded-full transition-all backdrop-blur-sm ${i === currentImageIndex ? 'bg-orange-500' : 'bg-white/30'}`} />
                        )) : null}
                      </div>

                      {/* Затемнение внизу для читаемости */}
                      <div
                        className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none"
                        style={{ height: '45%', background: 'linear-gradient(0deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 30%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0) 100%)' }}
                      />

                      {/* Имя, возраст и байк внизу */}
                      <div className="absolute bottom-6 left-6 right-6 z-30 pointer-events-none">
                        <h3 className="text-4xl font-black tracking-tight uppercase italic text-white drop-shadow-2xl mb-2">{currentBiker.name}, {currentBiker.age}</h3>
                        <div className="flex items-center gap-2">
                          <Zap size={16} className="text-orange-500 fill-orange-500 drop-shadow-2xl" />
                          <p className="text-orange-500 text-sm font-bold uppercase tracking-widest drop-shadow-2xl">{currentBiker.has_bike ? currentBiker.bike : "Ищу того, кто прокатит"}</p>
                        </div>
                      </div>


                      {/* Индикаторы свайпа влево/вправо */}
                      {isDragging && Math.abs(dragOffset.x) > 50 && (
                        <div className={`absolute top-1/2 -translate-y-1/2 z-40 pointer-events-none ${
                          dragOffset.x > 0 ? 'right-8' : 'left-8'
                        }`}>
                          <div className={`p-4 rounded-2xl backdrop-blur-xl ${
                            dragOffset.x > 0 
                              ? 'bg-green-500/20 border border-green-400/30' 
                              : 'bg-red-500/20 border border-red-400/30'
                          }`}>
                            {dragOffset.x > 0 ? (
                              <Heart size={32} className="text-green-400 fill-green-400" />
                            ) : (
                              <X size={32} className="text-red-400" />
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Описание (появляется при скролле) */}
                    <div className="bg-black/80 backdrop-blur-3xl border-t border-white/10 shrink-0 transition-all duration-500 ease-in-out">
                      <div className="p-8 space-y-6">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xl font-black uppercase italic text-white">О себе</h4>
                        </div>
                        <p className="text-lg text-zinc-200 leading-relaxed font-light italic">"{currentBiker.about || 'Пользователь не указал информацию о себе'}"</p>
                        <div className="grid grid-cols-2 gap-3">
                          {currentBiker.interests && currentBiker.interests.map((item, idx) => (
                            <div key={idx} className="bg-white/[0.05] backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col gap-1">
                              <div className="text-zinc-300 flex items-center gap-2 mb-1">{item.icon}<span className="text-[9px] uppercase font-bold tracking-tighter">{item.label}</span></div>
                              <span className="text-sm font-semibold text-white/90">{item.value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="h-16 transition-all duration-300 ease-in-out" />
                      </div>
                    </div>
                  </div>
                </article>

                {/* Панель действий под окошком */}
                <div className="w-full max-w-md flex items-center justify-center gap-10 shrink-0 py-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDislike(); }} 
                    className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-90 shadow-lg hover:bg-white/20 transition-all relative z-50"
                  >
                    <X size={28} className="text-white/90" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleLike(); }} 
                    className="w-20 h-20 rounded-full bg-gradient-to-r from-red-500 to-orange-500 flex items-center justify-center shadow-2xl active:scale-90 hover:scale-105 transition-all relative z-50"
                  >
                    <Heart fill="white" size={36} className="text-white" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Search size={48} className="text-zinc-800 mb-4" />
                <p className="text-zinc-600 text-sm italic uppercase tracking-wider mb-2">
                  {filteredBikers.length === 0 ? 'Нет анкет в этом городе' : 'Анкеты закончились'}
                </p>
                <p className="text-zinc-700 text-xs">
                  {filteredBikers.length === 0 
                    ? 'Попробуйте изменить город в настройках' 
                    : 'Зайдите позже, появятся новые'
                  }
                </p>
              </div>
            )}
          </div>
        )}

        {/* КАРТА */}
        {activeTab === 'map' && (
          <div className="h-full overflow-y-auto bg-black animate-in fade-in">
            {/* КАРТА */}
            <div className={`relative bg-[#0a0a0a] ${isMapFullscreen ? 'fixed inset-0 z-50' : 'mx-4 mt-4 rounded-[32px]'} border border-white/10 overflow-hidden`} style={{ height: isMapFullscreen ? '100vh' : '40vh', minHeight: isMapFullscreen ? '100vh' : '300px' }}>
              {userData && (
                <>
                  {isMapFullscreen && (
                    <button
                      onClick={() => setIsMapFullscreen(false)}
                      className="absolute top-4 right-4 z-[1000] bg-black/80 backdrop-blur-xl border border-white/10 p-3 rounded-full text-white hover:bg-white/20 transition-colors"
                    >
                      <Minimize2 size={20} />
                    </button>
                  )}

                  <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-black/20"><Loader2 size={32} className="text-orange-500 animate-spin" /></div>}>
                    <EventsMap
                      userData={mapUserData}
                      bikers={cityBikers}
                      events={cityEvents}
                    />
                  </Suspense>
                </>
              )}
            </div>

            {/* БАЙКЕРЫ РЯДОМ - под картой */}
            {!isMapFullscreen && (
              <div className="mx-4 mt-4 bg-black/80 backdrop-blur-xl border border-white/10 p-4 rounded-[24px] flex items-center gap-3">
                <Navigation className="text-orange-500" size={18} />
                <div className="flex-1">
                  <p className="text-xs font-black uppercase italic text-white">Байкеры рядом</p>
                  <p className="text-[10px] text-zinc-500 uppercase">В сети: {cityBikers.length}</p>
                </div>
                <button
                  onClick={() => setIsMapFullscreen(true)}
                  className="bg-orange-600 p-2 rounded-full text-white hover:bg-orange-700 transition-colors"
                  title="Открыть на полный экран"
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            )}

            {/* СЕКЦИЯ СОБЫТИЙ - только не в полноэкранном режиме */}
            {!isMapFullscreen && (
              <div className="px-4 mt-6 pb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">События в вашем городе</h3>
                <button 
                  onClick={() => setShowEventModal(true)}
                  className="bg-orange-600 w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                >
                  <Plus size={16} />
                </button>
              </div>
              
              <div className="space-y-3">
                {events.map(event => {
                  const isMyEvent = event.created_by_id === localStorage.getItem('userId');
                  return (
                    <div key={event.id} className="bg-white/3 border border-white/5 rounded-[24px] p-5 relative group">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-bold text-sm uppercase italic flex-1 pr-6">{event.title}</h4>
                        {isMyEvent && (
                          <button 
                            onClick={(e) => deleteEvent(e, event.id)}
                            className="absolute top-4 right-4 text-zinc-600 hover:text-red-500 transition-colors p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      {event.description && (
                      <p className="text-xs text-zinc-400 mb-3 italic">{event.description}</p>
                    )}
                    <div className="flex flex-col gap-2 mt-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                        {event.date && (
                          <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg flex-1 justify-center">
                            <Calendar size={14} className="text-orange-500" />
                            <span>{formatEventDate(event.date)}</span>
                          </div>
                        )}
                        {event.time && (
                          <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg flex-1 justify-center">
                            <Clock size={14} className="text-orange-500" />
                            <span>{formatEventTime(event.time)}</span>
                          </div>
                        )}
                      </div>
                      {event.address && (
                        <button 
                          onClick={() => {
                            // Определяем, мобильное ли устройство
                            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                            
                            if (isMobile) {
                              // На мобильных открываем Яндекс Навигатор приложение
                              // Используем правильный формат для конечной точки
                              const yandexNavigatorUrl = `yandexnavi://show_point?text=${encodeURIComponent(event.address)}&lat=&lon=`;
                              
                              // Пробуем открыть приложение
                              window.location.href = yandexNavigatorUrl;
                              
                              // Fallback - строим маршрут до точки
                              setTimeout(() => {
                                const routeUrl = `yandexnavi://build_route_on_map?text_to=${encodeURIComponent(event.address)}`;
                                window.location.href = routeUrl;
                              }, 1000);
                              
                              // Если приложение не установлено - открываем веб-версию
                              setTimeout(() => {
                                const webUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(event.address)}`;
                                window.open(webUrl, '_blank');
                              }, 3000);
                            } else {
                              // На компьютере открываем Яндекс Карты с точкой
                              const yandexMapsUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(event.address)}`;
                              window.open(yandexMapsUrl, '_blank');
                            }
                          }}className="flex items-center gap-2 text-xs text-zinc-500 px-1 hover:text-orange-500 transition-colors cursor-pointer"
                        >
                          <MapPin size={14} className="shrink-0" />
                          <span className="truncate">{event.address}</span>
                        </button>
                      )}
                    </div>
                    {event.link && (
                      <a 
                        href={event.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-2 text-xs text-orange-500 hover:text-orange-400 font-bold uppercase transition-colors"
                      >
                        <span>Подробнее →</span>
                      </a>
                    )}
                    {/* Кнопка присоединения к групповому чату */}
                    {event.group_chat_id && (
                      <button 
                        onClick={() => openGroupChat(event)}
                        className="mt-3 w-full bg-orange-600 hover:bg-orange-700 text-white text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                      >
                        <MessageCircle size={14} />
                        <span>Присоединиться к чату</span>
                      </button>
                    )}
                  </div>
                  );
                })}
                {events.length === 0 && (
                  <div className="text-center py-8 text-zinc-600 text-xs italic">
                    Пока нет событий. Создайте первое!
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
        )}

        {/* ЧАТЫ + НОВЫЕ МЭТЧИ */}
        {activeTab === 'chats' && !selectedChat && (
          <div className="h-full bg-black overflow-y-auto p-6 animate-in fade-in">
            {/* СЕКЦИЯ НОВЫХ МЭТЧЕЙ */}
            {newMatches.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4 ml-1">Новые мэтчи</h3>
              <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide px-1 pt-2">
                {newMatches.map(match => (
                    <button
                      key={match.id}
                      onClick={() => {
                        const existingChat = chats.find(c => c.id === match.chatId);
                        if (existingChat) {
                          openChat(existingChat);
                        } else {
                          // Если чата еще нет в стейте, загружаем его через новый API
                          const loadChat = async () => {
                            try {
                              const chatsData = await apiClient.getChats();
                              const chatData = chatsData.find(chat => chat.id === match.chatId);
                              
                              if (chatData) {
                                const currentUserId = localStorage.getItem('userId');
                                const partner = chatData.participant_1_id === currentUserId 
                                  ? chatData.participant_2 
                                  : chatData.participant_1;
                                
                                const newChat = {
                                  id: chatData.id,
                                  name: partner.name,
                                  image: partner.image || match.image || match.images?.[0],
                                  lastMessage: "Вы пара!",
                                  messages: [],
                                  online: true,
                                  time: "только что",
                                  unreadCount: 0,
                                  partnerId: partner.id
                                };
                                setChats([newChat, ...chats]);
                                openChat(newChat);
                              }
                            } catch (error) {
                              console.error('Error loading chat:', error);
                            }
                          };
                          loadChat();
                        }
                        // Убираем из новых мэтчей
                        setNewMatches(prev => prev.map(m => m.chatId === match.chatId ? {...m, isNew: false} : m));
                      }}
                      className="flex-shrink-0 flex flex-col items-center gap-2 active:scale-95 transition-transform"
                    >
                    <div className={`w-14 h-14 rounded-full ${match.isNew ? 'bg-gradient-to-t from-orange-600 to-yellow-400 ring-2 ring-orange-500' : 'bg-gradient-to-t from-zinc-700 to-zinc-800'} p-0.5`}>
                      <img src={match.image || match.images?.[0]} className="w-full h-full object-cover rounded-full" alt="" />
                    </div>
                    <span className={`text-[10px] font-bold uppercase italic ${match.isNew ? 'text-orange-500' : 'text-zinc-400'}`}>{match.name}</span>
                    </button>
                ))}
              </div>
            </div>
            )}

            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4 ml-1">Сообщения</h3>
            {chats.length > 0 ? (
            <div className="space-y-3">
                {chats.map(chat => {
                  const isNewMatch = newMatches.some(m => m.chatId === chat.id && m.isNew);
                  
                  const handleTouchStart = (e) => {
                    const touch = e.targetTouches[0];
                    chat.touchStartX = touch.clientX;
                  };
                  
                  const handleTouchMove = (e) => {
                    const touch = e.targetTouches[0];
                    chat.touchCurrentX = touch.clientX;
                  };
                  
                  const handleTouchEnd = () => {
                    if (!chat.touchStartX || !chat.touchCurrentX) return;
                    const distance = chat.touchStartX - chat.touchCurrentX;
                    const minSwipeDistance = 50;
                    
                    if (distance > minSwipeDistance) {
                      setSwipedChatId(chat.id);
                    } else if (distance < -minSwipeDistance) {
                      setSwipedChatId(null);
                    }
                    
                    chat.touchStartX = null;
                    chat.touchCurrentX = null;
                  };
                  
                  return (
                    <div key={chat.id} className="relative overflow-hidden">
                      <div 
                        className={`flex transition-transform duration-300 ${swipedChatId === chat.id ? '-translate-x-32' : 'translate-x-0'}`}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                      >
                        <button 
                          onClick={() => {
                            setSwipedChatId(null);
                            if (chat.is_group_chat) {
                              // Открываем групповой чат
                              openGroupChatFromChats(chat);
                            } else {
                              // Открываем обычный чат
                              openChat(chat);
                            }
                          }} 
                          className={`w-full flex items-center gap-4 p-5 rounded-[24px] border hover:scale-[1.01] active:scale-[0.99] transition-all text-left shrink-0 ${
                            isNewMatch 
                              ? 'bg-orange-600/10 border-orange-500 border-2 shadow-lg shadow-orange-500/20' 
                              : 'bg-white/3 border-white/5'
                          }`}
                        >
                          <div className="relative">
                            {chat.is_group_chat ? (
                              <div className={`w-14 h-14 rounded-[22px] bg-gradient-to-tr from-orange-600 to-yellow-500 flex items-center justify-center ${isNewMatch ? 'ring-2 ring-orange-500' : ''}`}>
                                <MessageCircle size={24} className="text-white" />
                              </div>
                            ) : (
                              <img src={chat.image || DEFAULT_AVATAR} className={`w-14 h-14 rounded-[22px] object-cover ${isNewMatch ? 'ring-2 ring-orange-500' : ''}`} alt="" />
                            )}
                            {!chat.is_group_chat && /* onlineUsers.has(chat.partnerId) && */ <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-black"></div>}
                            {chat.unreadCount > 0 && <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-600 rounded-full border-2 border-black" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm uppercase italic">{chat.name}</span>
                                {isNewMatch && (
                                  <span className="px-2 py-0.5 bg-orange-600 text-[8px] font-black uppercase rounded-full text-white animate-pulse">new</span>
                                )}
                              </div>
                              <span className="text-[9px] text-zinc-600 font-bold uppercase">{chat.time}</span>
                            </div>
                            <p className={`text-xs line-clamp-1 ${chat.unreadCount > 0 ? 'text-white font-bold' : 'text-zinc-500'}`}>{chat.lastMessage}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSwipedChatId(swipedChatId === chat.id ? null : chat.id);
                            }}
                            className="p-2 text-zinc-500"
                          >
                            <ChevronDown size={16} className="rotate-90" />
                          </button>
                        </button>
                        
                        {/* Кнопки действий при свайпе */}
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          <button
                            onClick={() => {
                              if (confirm('Удалить чат?')) {
                                deleteChat(chat.id);
                                setSwipedChatId(null);
                              }
                            }}
                            className="h-full px-6 bg-red-600 rounded-[24px] flex items-center justify-center hover:scale-[1.05] active:scale-[0.95] transition-all"
                          >
                            <Trash2 size={20} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Заблокировать пользователя?')) {
                                blockUser(chat.id);
                                setSwipedChatId(null);
                              }
                            }}
                            className="h-full px-6 bg-zinc-800 rounded-[32px] flex items-center justify-center active:scale-95"
                          >
                            <Ban size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MessageCircle size={48} className="text-zinc-800 mb-4" />
                <p className="text-zinc-600 text-sm italic uppercase tracking-wider">Пока нет сообщений</p>
                <p className="text-zinc-700 text-xs mt-2">Начните общение с новыми мэтчами</p>
            </div>
            )}
          </div>
        )}

        {/* ОКНО ЧАТА */}
        {selectedChat && (
          <div className="absolute inset-0 bg-black z-50 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="h-20 shrink-0 border-b border-white/5 flex items-center px-6 gap-4 bg-black/80 backdrop-blur-xl">
              <button onClick={() => { setSelectedChat(null); setMessageInput(''); }} className="p-2 bg-white/5 rounded-xl active:scale-90 transition-all"><ChevronLeft size={20}/></button>
              <button 
                className="flex items-center gap-3 text-left active:opacity-70 transition-opacity"
                onClick={() => selectedChat.partnerId && handleOpenProfile(selectedChat.partnerId)}
              >
                  <img src={selectedChat.image || DEFAULT_AVATAR} className="w-10 h-10 rounded-xl object-cover border border-white/10" alt="" />
                <div>
                <h4 className="font-bold text-sm uppercase italic">{selectedChat.name || 'Пользователь'}</h4>
                  {selectedChat.partnerId && /* onlineUsers.has(selectedChat.partnerId) && */ <p className="text-[9px] text-green-500 font-bold uppercase">В сети</p>}
                </div>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 flex flex-col scrollbar-hide">
              {selectedChat.messages && selectedChat.messages.length > 0 ? (
                <>
              {groupMessagesByDate(selectedChat.messages).map((item, idx) => {
                if (item.type === 'separator') {
                  return (
                    <div key={`sep-${idx}`} className="flex items-center justify-center my-4">
                      <div className="bg-zinc-800 text-zinc-400 px-3 py-1 rounded-full text-xs font-medium">
                        {item.date}
                      </div>
                    </div>
                  );
                }
                
                const msg = item;
                return (
                  <div 
                      key={msg.id || idx} 
                      className={`max-w-[85%] relative group ${msg.sender === 'me' ? 'self-end' : 'self-start'}`}
                      onClick={() => {
                          if (msg.sender === 'me') {
                              setContextMenuMessageId(contextMenuMessageId === msg.id ? null : msg.id);
                          }
                      }}
                  >
                      {/* Context Menu for Edit/Delete */}
                      {contextMenuMessageId === msg.id && msg.sender === 'me' && (
                          <div className="absolute bottom-full right-0 mb-2 bg-[#1c1c1e] border border-white/10 rounded-xl p-2 shadow-2xl z-50 flex flex-col gap-1 min-w-[120px] animate-in fade-in zoom-in-95 duration-200">
                              <button 
                                  onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id); }}
                                  className="flex items-center gap-2 px-3 py-2 hover:bg-red-500/20 text-red-500 rounded-lg text-sm transition-colors text-left"
                              >
                                  <Trash2 size={14} /> Удалить
                              </button>
                          </div>
                      )}

                      {msg.type === 'image' ? (
                        <div className="relative">
                            <img 
                              src={msg.image} 
                              alt="Sent" 
                              onClick={() => {
                                setSelectedImage(msg.image);
                                // Получаем все фото из этого чата
                                const chatImages = selectedChat?.messages?.filter(m => m.type === 'image').map(m => m.image) || [];
                                const currentIndex = chatImages.indexOf(msg.image);
                                setImageContext({ type: 'chat', images: chatImages, currentIndex });
                              }}
                              className={`rounded-2xl ${msg.sender === 'me' ? 'rounded-br-none' : 'rounded-bl-none'} max-w-[200px] h-auto cursor-pointer active:opacity-80 transition-opacity`}
                            />
                            <div className={`absolute bottom-2 right-2 px-1.5 py-0.5 rounded-full bg-black/40 backdrop-blur-md flex items-center gap-1`}>
                                <span className="text-[9px] text-white/90 font-medium">
                                    {formatMessageTime(msg.created_at)}
                                </span>
                                {msg.sender === 'me' && (
                                     msg.is_read ? <CheckCheck size={10} className="text-white/90" /> : <Check size={10} className="text-white/90" />
                                 )}
                            </div>
                        </div>
                      ) : (
                        <div className={`px-3 py-2 rounded-2xl text-sm border relative min-w-[80px] ${msg.sender === 'me' ? 'bg-orange-600 border-orange-600 text-white rounded-br-none' : 'bg-[#2c2c2e] border-white/5 text-zinc-200 rounded-bl-none'}`}>
                          <div className="flex flex-wrap gap-x-2 items-end">
                            <span className="leading-relaxed break-words whitespace-pre-wrap">{msg.text || ''}</span>
                            {msg.is_edited && <span className="text-[9px] opacity-60 self-center">(ред.)</span>}
                            <div className={`flex items-center gap-1 select-none ml-auto h-4 ${msg.sender === 'me' ? 'text-white/70' : 'text-zinc-500'}`}>
                               <span className="text-[9px] font-medium">
                                  {formatMessageTime(msg.created_at)}
                               </span>
                               {msg.sender === 'me' && (
                                  msg.is_read ? <CheckCheck size={12} /> : <Check size={12} />
                               )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
              )}
              <div ref={messagesEndRef} />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-zinc-600 text-sm">Начните общение первым!</p>
                </div>
              )}
            </div>
            
            {/* Индикатор печатания */}
            {isPartnerTyping && (
              <div className="px-6 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-zinc-500 text-xs">Собеседник печатает...</span>
                </div>
              </div>
            )}
            
            {/* Emoji Picker */}
            {showEmojiPicker && (
              <div className="absolute bottom-20 right-6 bg-[#1c1c1e] border border-white/10 rounded-2xl p-3 shadow-2xl z-50 max-h-60 overflow-y-auto">
                <div className="grid grid-cols-6 gap-2">
                  {['😀', '😍', '🔥', '🏍️', '❤️', '👍', '😎', '🤘', '🌟', '💨', '😂', '🎉', 
                    '😜', '😇', '🤔', '🤫', '🤭', '🤗', '🤩', '🥳', '🥺', '🤯', '🤠', '😈',
                    '👻', '💀', '👽', '🤖', '💩', '😺', '😸', '😹', '😻', '😼', '😽', '🙀',
                    '😿', '😾', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟',
                    '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛'
                  ].map((emoji, idx) => (
                    <button
                      key={`${emoji}-${idx}`}
                      onClick={() => {
                        setMessageInput(prev => prev + emoji);
                        setShowEmojiPicker(false);
                      }}
                      className="w-10 h-10 hover:bg-white/10 rounded-lg flex items-center justify-center text-xl transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <div className="p-3 bg-black border-t border-white/5 flex gap-2 items-end">
              <input 
                type="file" 
                ref={chatFileInputRef}
                accept="image/*"
                multiple
                onChange={(e) => handleImageUpload(e, false)}
                className="hidden"
              />
              <button
                onClick={() => chatFileInputRef.current?.click()}
                className="bg-white/5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-zinc-400 active:scale-95 transition-all"
              >
                <Camera size={18} />
              </button>
              <textarea 
                placeholder="Сообщение..." 
                value={messageInput}
                onChange={(e) => {
                  setMessageInput(e.target.value);
                  if (e.target.value.length > 0 && selectedChat && window.apiManager) {
                     window.apiManager.sendTyping(selectedChat.id);
                  }
                }}
                className="flex-1 bg-white/5 border border-white/10 rounded-[18px] px-4 py-2 text-sm outline-none focus:border-orange-500/50 transition-colors resize-none min-h-[36px] max-h-32 leading-relaxed" 
                rows={1}
                style={{ height: 'auto' }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
              />
              <button 
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="bg-white/5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-zinc-400 active:scale-95 transition-all relative"
              >
                <Smile size={18} />
              </button>
              <button 
                onClick={sendMessage}
                disabled={!messageInput.trim()}
                className="bg-orange-600 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ОКНО ГРУППОВОГО ЧАТА */}
        {selectedGroupChat && (
          <div className="absolute inset-0 bg-black z-50 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="h-20 shrink-0 border-b border-white/5 flex items-center px-6 gap-4 bg-black/80 backdrop-blur-xl">
              <button onClick={() => { setSelectedGroupChat(null); setGroupChatMessageInput(''); }} className="p-2 bg-white/5 rounded-xl active:scale-90 transition-all"><ChevronLeft size={20}/></button>
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-600 to-yellow-500 flex items-center justify-center">
                  <MessageCircle size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-sm uppercase italic">{selectedGroupChat.name || 'Чат события'}</h4>
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] text-zinc-500 font-bold uppercase">
                      {selectedGroupChat.group_chat_participants?.length || 0} участников
                    </p>
                    <button 
                      onClick={() => setShowParticipants(true)}
                      className="text-[9px] text-orange-500 font-bold uppercase hover:text-orange-400 transition-colors"
                    >
                      Участники
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 flex flex-col scrollbar-hide">
              {selectedGroupChat.messages && selectedGroupChat.messages.length > 0 ? (
                <>
                {groupMessagesByDate(selectedGroupChat.messages).map((item, idx) => {
                  if (item.type === 'separator') {
                    return (
                      <div key={`sep-${idx}`} className="flex items-center justify-center my-4">
                        <div className="bg-zinc-800 text-zinc-400 px-3 py-1 rounded-full text-xs font-medium">
                          {item.date}
                        </div>
                      </div>
                    );
                  }
                  
                  const msg = item;
                  const currentUserId = localStorage.getItem('userId');
                  const isOwnMessage = msg.sender_id === currentUserId;
                  
                  return (
                    <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-1`}>
                      <div className={`max-w-[70%] ${isOwnMessage ? 'order-2' : 'order-1'}`}>
                        <div className={`group relative flex items-end gap-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          {/* Аватарка для входящих сообщений */}
                          {!isOwnMessage && (
                            <button
                              onClick={async () => {
                                const sender = msg.sender;
                                if (sender) {
                                  await openUserProfile(sender.id);
                                }
                              }}
                              className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-600 to-yellow-500 flex items-center justify-center hover:scale-110 transition-transform flex-shrink-0 border-2 border-black"
                            >
                              {msg.sender?.image ? (
                                <img src={msg.sender.image} alt={msg.sender.name} className="w-full h-full rounded-full object-cover" />
                              ) : (
                                <User size={14} className="text-white" />
                              )}
                            </button>
                          )}
                          
                          <div className={`px-4 py-2 rounded-2xl ${
                            isOwnMessage 
                              ? 'bg-orange-600 text-white rounded-br-md' 
                              : 'bg-white/10 text-white rounded-bl-md'
                          }`}>
                            {/* Имя отправителя внутри сообщения */}
                            {!isOwnMessage && (
                              <button
                                onClick={async () => {
                                  const sender = msg.sender;
                                  if (sender) {
                                    await openUserProfile(sender.id);
                                  }
                                }}
                                className="text-xs font-bold text-orange-500 hover:text-orange-400 transition-colors mb-1 text-left"
                              >
                                {msg.sender?.name || 'Пользователь'}
                              </button>
                            )}
                            
                            {msg.type === 'text' && (
                              <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                            )}
                            {msg.type === 'image' && (
                              <img 
                                src={msg.image} 
                                alt="Message image" 
                                className="rounded-xl max-w-full cursor-pointer active:scale-95 transition-transform"
                                onClick={() => {
                                  setSelectedImage(msg.image);
                                  const chatImages = selectedGroupChat?.messages?.filter(m => m.type === 'image').map(m => m.image) || [];
                                  const currentIndex = chatImages.indexOf(msg.image);
                                  setImageContext({ type: 'chat', images: chatImages, currentIndex });
                                }}
                                loading="lazy"
                              />
                            )}
                            <div className={`flex items-center gap-1 mt-1 text-xs ${
                              isOwnMessage ? 'text-orange-200' : 'text-zinc-500'
                            }`}>
                              <span>{formatMessageTime(msg.created_at)}</span>
                              {isOwnMessage && (
                                <span className="ml-1">
                                  {msg.read ? <CheckCheck size={12} /> : <Check size={12} />}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-zinc-500 text-sm">Нет сообщений. Начните общение первым!</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="shrink-0 border-t border-white/5 p-4 bg-black/80 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={groupChatMessageInput}
                  onChange={(e) => setGroupChatMessageInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendGroupMessage()}
                  placeholder="Сообщение в чате события..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-[18px] px-4 py-2 text-sm outline-none focus:border-orange-500/50 transition-colors resize-none min-h-[36px] max-h-32 leading-relaxed" 
                />
                <button 
                  onClick={() => setShowGroupChatEmojiPicker(!showGroupChatEmojiPicker)}
                  className="bg-white/5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-zinc-400 active:scale-95 transition-all relative"
                >
                  <Smile size={18} />
                </button>
                <button 
                  onClick={sendGroupMessage}
                  disabled={!groupChatMessageInput.trim()}
                  className="bg-orange-600 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ПРОФИЛЬ */}
        {activeTab === 'profile' && !showSettings && (
          <div className="h-full overflow-y-auto p-6 animate-in fade-in flex flex-col items-center pt-10">
            {!userData ? (
                <div className="flex-1 flex flex-col items-center justify-center h-full mt-20">
                  {error ? (
                    <>
                      <div className="text-red-500 text-center mb-4">
                        <p className="text-sm">{error}</p>
                        <button 
                          onClick={() => {
                            setError(null);
                            window.location.reload();
                          }}
                          className="mt-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm"
                        >
                          Обновить страницу
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Loader2 className="animate-spin text-orange-500 mb-4" size={32} />
                      <p className="text-zinc-500 text-sm italic">Загрузка профиля...</p>
                    </>
                  )}
                </div>
            ) : (
            <>
            <div className="relative mb-8">
              <button 
                onClick={() => profileInputRef.current?.click()}
                className="w-32 h-32 rounded-[44px] bg-gradient-to-tr from-orange-600 to-yellow-500 p-1 cursor-pointer hover:opacity-90 transition-opacity active:scale-95"
              >
                <div className="w-full h-full rounded-[42px] bg-zinc-900 flex items-center justify-center overflow-hidden border-4 border-black">
                  {userData?.image ? (
                    <img 
                      src={userData.image} 
                      className="w-full h-full object-cover" 
                      alt="Profile" 
                      loading="lazy"
                    />
                  ) : (
                    <User size={60} className="text-zinc-800" />
                  )}
                </div>
              </button>
              <button onClick={() => setShowSettings(true)} data-edit-profile="true" className="absolute bottom-0 right-0 bg-orange-600 p-3 rounded-2xl border-4 border-black text-white transition-transform active:scale-90"><Edit3 size={18} /></button>
            </div>
            <h2 className="text-2xl font-black uppercase italic mb-2 flex items-center gap-2">
              {userData.name}
              {userData.is_private && (
                <div className="w-3 h-3 bg-zinc-500 rounded-full" title="Режим инкогнито"></div>
              )}
            </h2>
            <p className="text-zinc-600 text-xs font-bold uppercase tracking-[0.2em] mb-2">{userData.city}</p>
            {(userData.bike || !userData.has_bike) && (
              <div className="flex items-center gap-2 mb-12">
                <Zap size={14} className="text-orange-500 fill-orange-500" />
                <p className="text-orange-500 text-xs font-bold uppercase tracking-widest">{userData.has_bike ? userData.bike : "Ищу того, кто прокатит"}</p>
              </div>
            )}
            
            {/* ГАЛЕРЕЯ ФОТО */}
            <div className="w-full mb-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4 text-center">Галерея</h3>
                <div className="flex flex-wrap justify-center gap-3 w-full max-w-4xl mx-auto">
                  {userImages.map((img, idx) => {
                    const isMainPhoto = userData?.image === img;
                    return (
                      <div key={idx} className="w-[calc(45%-8px)] sm:w-24 md:w-32 aspect-square rounded-2xl sm:rounded-3xl overflow-hidden border border-white/10 relative group cursor-pointer shadow-lg active:scale-95 transition-all" onClick={() => {
                        setSelectedImage(img);
                        setImageContext({ type: 'gallery', images: userImages, currentIndex: idx });
                      }}>
                        <img src={img} className="w-full h-full object-cover hover:scale-110 transition-transform duration-500" alt={`Photo ${idx + 1}`} />
                        {isMainPhoto && (
                          <div className="absolute top-1 left-1 px-2 py-0.5 bg-orange-600 text-[8px] font-black uppercase rounded-lg shadow-lg z-10">Главное</div>
                        )}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (window.confirm('Вы точно хотите удалить фотографию?')) {
                              const imageToDelete = userImages[idx];
                              const newImages = userImages.filter((_, i) => i !== idx);
                              setUserImages(newImages);
                              await updateGallery(newImages);
                              await deleteGalleryImageByUrl(imageToDelete);
                              if (isMainPhoto) {
                                setUserData({...userData, image: null});
                              }
                            }
                          }}
                          className="absolute top-1 right-1 bg-red-600/90 hover:bg-red-600 rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity active:scale-90 shadow-lg z-10"
                        >
                          <X size={12} className="text-white" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-[calc(45%-8px)] sm:w-24 md:w-32 aspect-square rounded-2xl sm:rounded-3xl border-2 border-dashed border-white/10 flex items-center justify-center hover:border-orange-500/50 hover:bg-orange-500/5 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    {isUploading ? (
                      <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Plus size={24} className="text-zinc-600 group-hover:text-orange-500 transition-colors" />
                        <span className="text-[9px] font-black uppercase text-zinc-600 group-hover:text-orange-500 transition-colors hidden sm:block">Добавить</span>
                      </div>
                    )}
                  </button>
                </div>
              </div>
            
            {/* Скрытый input для галереи */}
            <input 
              type="file" 
              ref={galleryInputRef}
              accept="image/*"
              onChange={(e) => handleImageUpload(e, false, true)}
              className="hidden"
            />
            <div className="w-full max-w-md space-y-3">
              <button onClick={() => { setSettingsDraft({...userData}); setShowSettings(true); }} data-edit-profile="true" className="w-full bg-white/[0.03] border border-white/5 p-6 rounded-[32px] flex items-center justify-between">
                <div className="flex items-center gap-4 text-orange-500"><Edit3 size={20}/><span className="font-bold uppercase tracking-tighter text-sm text-white">Редактирование анкеты</span></div>
                <ChevronLeft size={20} className="rotate-180 text-zinc-700" />
              </button>

              <button onClick={() => setShowAppSettings(true)} className="w-full bg-white/[0.03] border border-white/5 p-6 rounded-[32px] flex items-center justify-between">
                <div className="flex items-center gap-4 text-zinc-400"><Settings size={20}/><span className="font-bold uppercase tracking-tighter text-sm text-white">Настройки</span></div>
                <ChevronLeft size={20} className="rotate-180 text-zinc-700" />
              </button>

              <button onClick={async () => {
                 try {
                   setIsLoggingOut(true);
                   // Custom logout
                   apiClient.removeToken();
                   localStorage.removeItem('motomate_token');
                   localStorage.removeItem('userId');
                   localStorage.removeItem('userData');
                   sessionStorage.clear();
                   localStorage.clear();
                   
                   // Принудительная перезагрузка с очисткой кэша
                   setTimeout(() => {
                     if ('caches' in window) {
                       caches.keys().then(names => {
                         names.forEach(name => {
                           caches.delete(name);
                         });
                       });
                     }
                     window.location.href = window.location.origin + '?logout=true&t=' + Date.now();
                   }, 200);
                 } catch (error) {
                   console.error('Error signing out:', error);
                   setIsLoggingOut(false);
                   setTimeout(() => {
                     window.location.href = window.location.origin + '?logout=true&t=' + Date.now();
                   }, 200);
                 }
               }} className="w-full bg-white/[0.02] border border-white/5 p-6 rounded-[32px] flex items-center justify-between">
                 <div className="flex items-center gap-4 text-red-500">
                   {isLoggingOut ? (
                     <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                   ) : (
                     <LogOut size={20}/>
                   )}
                   <span className="font-bold uppercase tracking-tighter text-sm text-white">
                     {isLoggingOut ? 'Выход...' : 'Выйти'}
                   </span>
                 </div>
              </button>
            </div>
            </>
            )}
          </div>
        )}

        {/* НАСТРОЙКИ */}
        {showSettings && (
          <div className="absolute inset-0 bg-black z-[100] p-6 overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="max-w-md mx-auto space-y-8 pb-10">
              <div className="flex items-center gap-4">
                <button onClick={() => setShowSettings(false)} className="p-2 bg-white/5 rounded-xl"><ChevronLeft size={24}/></button>
                <h2 className="text-xl font-black uppercase italic">Настройки</h2>
              </div>
              <div className="space-y-6 text-white">
                {/* ЗАГРУЗКА ФОТО ПРОФИЛЯ */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-600 uppercase">Фото профиля</label>
                  <input 
                    type="file" 
                    ref={profileInputRef}
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, true)}
                    className="hidden"
                  />
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl overflow-hidden border border-white/10">
                      {userData?.image ? (
                        <img src={userData.image} className="w-full h-full object-cover" alt="Profile" />
                      ) : (
                        <div className="w-full h-full bg-white/5 flex items-center justify-center">
                          <User size={32} className="text-zinc-600" />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => profileInputRef.current?.click()}
                      disabled={isUploading}
                      className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 text-sm font-bold uppercase active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Загрузка...
                        </>
                      ) : (
                        'Загрузить фото'
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2"><label className="text-[10px] font-black text-zinc-600 uppercase">Имя *</label><input type="text" value={settingsDraft?.name || ''} onChange={e => setSettingsDraft({...settingsDraft, name: e.target.value})} className={`w-full bg-white/5 border ${!settingsDraft?.name ? 'border-red-500/50' : 'border-white/10'} rounded-2xl p-4 outline-none focus:border-orange-500`} placeholder="Введите ваше имя" />
                  {!settingsDraft?.name && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">Поле обязательно для заполнения</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-600 uppercase">Возраст 18+ *</label>
                  <input 
                    type="number" 
                    min="18" 
                    max="100" 
                    value={settingsDraft?.age || ''} 
                    onChange={e => {
                      const value = e.target.value;
                      if (value === '') {
                        setSettingsDraft({...settingsDraft, age: null});
                      } else {
                        const age = parseInt(value);
                        if (!isNaN(age)) {
                          setSettingsDraft({...settingsDraft, age});
                        }
                      }
                    }} 
                    className={`w-full bg-white/5 border ${!settingsDraft?.age ? 'border-red-500/50' : 'border-white/10'} rounded-2xl p-4 outline-none focus:border-orange-500`}
                    placeholder="18+"
                  />
                  {!settingsDraft?.age && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">Поле обязательно для заполнения (18+)</p>}
                </div>
                <div className="space-y-2"><label className="text-[10px] font-black text-zinc-600 uppercase">Город *</label>
                  <div className="flex gap-2 items-stretch">
                    <div className="flex-1">
                      <CityAutocomplete
                        value={settingsDraft?.city || ''}
                        onChange={(value) => {
                          setSettingsDraft({ ...settingsDraft, city: value, latitude: null, longitude: null });
                        }}
                        placeholder="Введите город"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => requestGeolocation()}
                      disabled={geoLoading}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-orange-600/50 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                      title="Определить город по геолокации"
                    >
                      {geoLoading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Navigation size={16} />
                      )}
                      Авто
                    </button>
                  </div>
                  {!settingsDraft?.city && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">Выберите город из списка</p>}
                  {detectedCity && settingsDraft?.city !== detectedCity && (
                    <button
                      type="button"
                      onClick={() => setSettingsDraft({ ...settingsDraft, city: detectedCity, latitude: detectedCoordinates?.lat, longitude: detectedCoordinates?.lon })}
                      className="text-xs text-blue-400 hover:text-blue-300 mt-2 p-2 bg-blue-600/10 rounded-lg w-full"
                    >
                      ✓ Найден город: {detectedCity}
                    </button>
                  )}
                  {geoError && (
                    <p className="text-xs text-red-400 mt-1">{geoError}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-600 uppercase">Пол *</label>
                  <select 
                    value={settingsDraft?.gender || 'male'} 
                    onChange={e => setSettingsDraft({...settingsDraft, gender: e.target.value})} 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 outline-none appearance-none cursor-pointer focus:border-orange-500"
                  >
                    <option value="male" className="bg-zinc-900">Мужской</option>
                    <option value="female" className="bg-zinc-900">Женский</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-600 uppercase">Байк</label>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3 mb-2">
                       <button 
                         onClick={() => setSettingsDraft({...settingsDraft, has_bike: true})}
                         className={`flex-1 py-3 rounded-xl border transition-all ${settingsDraft?.has_bike ? 'bg-orange-500 border-orange-500 text-white font-bold' : 'bg-white/5 border-white/10 text-zinc-400'}`}
                       >
                         Есть байк
                       </button>
                       <button 
                         onClick={() => setSettingsDraft({...settingsDraft, has_bike: false, bike: ''})}
                         className={`flex-1 py-3 rounded-xl border transition-all ${!settingsDraft?.has_bike ? 'bg-orange-500 border-orange-500 text-white font-bold' : 'bg-white/5 border-white/10 text-zinc-400'}`}
                       >
                         Нет байка
                       </button>
                    </div>
                    {settingsDraft?.has_bike && (
                      <input 
                        type="text" 
                        value={settingsDraft?.bike || ''} 
                        onChange={e => setSettingsDraft({...settingsDraft, bike: e.target.value})} 
                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 outline-none focus:border-orange-500 animate-in fade-in slide-in-from-top-2" 
                        placeholder="Yamaha R1" 
                      />
                    )}
                  </div>
                </div>
                {/* ВЕРНУЛ ПОЛЕ О СЕБЕ */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-600 uppercase">О себе</label>
                  <textarea 
                    value={settingsDraft?.about || ''} 
                    onChange={e => setSettingsDraft({...settingsDraft, about: e.target.value})} 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 h-24 outline-none focus:border-orange-500 resize-none text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-600 uppercase">Темп</label>
                    <select 
                        value={settingsDraft?.temp || 'Спокойный'} 
                        onChange={e => setSettingsDraft({...settingsDraft, temp: e.target.value})} 
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none focus:border-orange-500 appearance-none cursor-pointer"
                    >
                        <option value="Спокойный" className="bg-zinc-900">Спокойный</option>
                        <option value="Динамичный" className="bg-zinc-900">Динамичный</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-600 uppercase">Музыка</label>
                    <select 
                        value={settingsDraft?.music || 'Рок'} 
                        onChange={e => setSettingsDraft({...settingsDraft, music: e.target.value})} 
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none focus:border-orange-500 appearance-none cursor-pointer"
                    >
                        {['Рок', 'Поп', 'Рэп', 'Техно', 'Шансон', 'Джаз', 'Метал', 'Классика'].map(genre => (
                            <option key={genre} value={genre} className="bg-zinc-900">{genre}</option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-600 uppercase">Экип</label>
                    <select 
                        value={settingsDraft?.equip || 'Только шлем'} 
                        onChange={e => setSettingsDraft({...settingsDraft, equip: e.target.value})} 
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none focus:border-orange-500 appearance-none cursor-pointer"
                    >
                        <option value="Только шлем" className="bg-zinc-900">Только шлем</option>
                        <option value="Полный" className="bg-zinc-900">Полный</option>
                        <option value="Нет экипировки" className="bg-zinc-900">Нет экипировки</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-600 uppercase">Цель</label>
                    <select 
                        value={settingsDraft?.goal || 'Только поездки'} 
                        onChange={e => setSettingsDraft({...settingsDraft, goal: e.target.value})} 
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none focus:border-orange-500 appearance-none cursor-pointer"
                    >
                        <option value="Только поездки" className="bg-zinc-900">Только поездки</option>
                        <option value="Симпатия и общение" className="bg-zinc-900">Симпатия и общение</option>
                    </select>
                  </div>
                </div>
              </div>
              <button 
                onClick={async () => {
                  try {
                    if (!isRequiredProfileFilled(settingsDraft)) {
                      alert('Заполните обязательные поля: Имя, Возраст 18+, Город и Пол');
                      return;
                    }

                    const updatedProfile = {
                        name: settingsDraft.name || null,
                        age: settingsDraft.age || null,
                        city: settingsDraft.city,
                        bike: settingsDraft.bike,
                        has_bike: settingsDraft.has_bike,
                        gender: settingsDraft.gender,
                        about: settingsDraft.about,
                        temp: settingsDraft.temp,
                        music: settingsDraft.music,
                        equip: settingsDraft.equip,
                        goal: settingsDraft.goal,
                        latitude: settingsDraft.latitude ?? null,
                        longitude: settingsDraft.longitude ?? null,
                        interests: [
                            { id: 'style', label: 'Стиль', value: settingsDraft.temp || 'Спокойный', icon: 'Gauge' },
                            { id: 'music', label: 'Музыка', value: settingsDraft.music || 'Рок', icon: 'Music' },
                            { id: 'equip', label: 'Экип', value: settingsDraft.equip || 'Только шлем', icon: 'Shield' },
                            { id: 'goal', label: 'Цель', value: settingsDraft.goal || 'Только поездки', icon: 'Target' }
                        ]
                    };

                    await apiClient.updateProfile(updatedProfile);
                    
                    // Обновляем userData только после успешного сохранения
                    setUserData({ ...userData, ...updatedProfile });
                    
                    // Обновляем кэш пользователей для ApiManager, чтобы сработал триггер на смену города
                    const cacheKey = `users_${updatedProfile.city}_${updatedProfile.gender}`;
                    localStorage.removeItem(cacheKey);

                    alert('Профиль успешно сохранен!');
                    setShowSettings(false);
                    
                    // Обновляем текущий индекс, если текущий байкер не из нового города
                    if (currentBiker && currentBiker.city !== settingsDraft.city) {
                        setCurrentIndex(0);
                    }
                    
                    // Async reload without blocking UI
                    if (window.apiManager?.loadUsers) {
                      console.log('Manually reloading users...');
                      window.apiManager.loadUsers().catch(() => {});
                    }
                    if (window.apiManager?.loadEvents) {
                      console.log('Manually reloading events...');
                      window.apiManager.loadEvents().catch(() => {});
                    }
                  } catch (err) {
                    console.error('Error saving profile:', err);
                    alert('Ошибка при сохранении профиля: ' + err.message);
                  }
                }} 
                disabled={!isRequiredProfileFilled(settingsDraft)}
                className="w-full bg-orange-600 disabled:bg-orange-600/40 disabled:cursor-not-allowed p-5 rounded-[24px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all"
              >
                Сохранить
              </button>
            </div>
          </div>
        )}

        {/* НОВЫЕ НАСТРОЙКИ ПРИЛОЖЕНИЯ */}
        {showAppSettings && (
          <div className="absolute inset-0 bg-black z-[100] p-6 overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="max-w-md mx-auto space-y-8 pb-10">
              <div className="flex items-center gap-4">
                <button onClick={() => setShowAppSettings(false)} className="p-2 bg-white/5 rounded-xl"><ChevronLeft size={24}/></button>
                <h2 className="text-xl font-black uppercase italic">Настройки</h2>
              </div>
              
              <div className="space-y-6 text-white">
                 <div className="p-6 bg-white/5 rounded-[24px] border border-white/10 space-y-4">
                   <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500">Аккаунт</h3>
                   <div className="space-y-2">
                     <label className="text-[10px] font-black text-zinc-600 uppercase">Почта</label>
                     {isEditingEmail ? (
                        <div className="space-y-2">
                            <input 
                               type="email" 
                               value={newEmail} 
                               onChange={(e) => setNewEmail(e.target.value)}
                               placeholder="Новый email"
                               className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm outline-none text-white focus:border-orange-500" 
                            />
                            <input
                               type="password"
                               value={emailCurrentPassword}
                               onChange={(e) => setEmailCurrentPassword(e.target.value)}
                               placeholder="Текущий пароль"
                               className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm outline-none text-white focus:border-orange-500"
                            />
                            <div className="flex gap-2">
                                <button disabled={isUpdatingEmail} onClick={handleEmailUpdate} className="flex-1 bg-orange-600 disabled:bg-orange-600/40 py-2 rounded-xl text-xs font-bold uppercase">{isUpdatingEmail ? 'Сохранение...' : 'Сохранить'}</button>
                                <button onClick={() => setIsEditingEmail(false)} className="flex-1 bg-white/10 py-2 rounded-xl text-xs font-bold uppercase">Отмена</button>
                            </div>
                        </div>
                     ) : (
                         <div className="flex gap-2">
                            <input 
                               type="email" 
                               value={userData?.email || ''} 
                               readOnly
                               className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-sm outline-none text-zinc-400 cursor-not-allowed" 
                            />
                            <button onClick={() => { setIsEditingEmail(true); setNewEmail(''); }} className="px-4 bg-white/10 rounded-xl font-bold uppercase text-xs hover:bg-white/20 transition-colors">Изм.</button>
                         </div>
                     )}
                   </div>
                   {/* СМЕНА ПАРОЛЯ */}
                   <div className="space-y-2 mt-4 pt-4 border-t border-white/5">
                     <label className="text-[10px] font-black text-zinc-600 uppercase">Пароль</label>
                     {isEditingPassword ? (
                        <div className="space-y-2">
                            <input
                               type="password"
                               value={passwordCurrentPassword}
                               onChange={(e) => setPasswordCurrentPassword(e.target.value)}
                               placeholder="Текущий пароль"
                               className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm outline-none text-white focus:border-orange-500"
                            />
                            <input 
                               type="password" 
                               value={newPassword} 
                               onChange={(e) => setNewPassword(e.target.value)}
                               placeholder="Новый пароль"
                               className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm outline-none text-white focus:border-orange-500" 
                            />
                            <div className="flex gap-2">
                                <button disabled={isUpdatingPassword} onClick={handlePasswordUpdate} className="flex-1 bg-orange-600 disabled:bg-orange-600/40 py-2 rounded-xl text-xs font-bold uppercase">{isUpdatingPassword ? 'Сохранение...' : 'Сохранить'}</button>
                                <button onClick={() => setIsEditingPassword(false)} className="flex-1 bg-white/10 py-2 rounded-xl text-xs font-bold uppercase">Отмена</button>
                            </div>
                        </div>
                     ) : (
                         <button onClick={() => { setIsEditingPassword(true); setNewPassword(''); }} className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold uppercase transition-colors flex items-center justify-between px-4">
                            <span>Сменить пароль</span>
                            <ChevronLeft size={16} className="rotate-180 text-zinc-600" />
                         </button>
                     )}
                   </div>
                 </div>
                 
                 {/* GHOST MODE */}
                 <PrivacySettings userData={userData} setUserData={setUserData} />

                 <button onClick={handleDeleteAccount} disabled={isLoggingOut} className="w-full bg-red-500/10 border border-red-500/20 p-6 rounded-[24px] flex items-center justify-center gap-2 text-red-500 disabled:opacity-50 font-black uppercase tracking-widest active:scale-95 transition-all">
                    <Trash2 size={20} />
                    {isLoggingOut ? 'Удаление...' : 'Удалить аккаунт'}
                 </button>
              </div>
            </div>
          </div>
        )}

        {/* ЭКРАН МЭТЧА - только в поиске */}
        {matchData && activeTab === 'search' && matchData.images && matchData.images.length > 0 && (
          <div className="absolute inset-0 z-[200] bg-black/90 backdrop-blur-3xl flex flex-col items-center justify-center p-6 animate-in zoom-in">
            <h2 className="text-5xl font-black italic uppercase tracking-tighter text-orange-500 animate-bounce mb-12 text-center">Это<br/>Мэтч!</h2>
            <div className="flex gap-4 mb-16 relative">
              <img src={userData.image || DEFAULT_AVATAR} className="w-32 h-32 rounded-[32px] border-4 border-white -rotate-12 object-cover" style={{ objectFit: 'cover' }} alt="" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-orange-600 p-4 rounded-full z-10 animate-pulse"><Heart fill="white" size={32}/></div>
              <img src={matchData.images[0] || DEFAULT_AVATAR} className="w-32 h-32 rounded-[32px] border-4 border-white rotate-12 object-cover" style={{ objectFit: 'cover' }} alt="" />
            </div>
            <div className="w-full max-w-xs space-y-4">
              <button onClick={() => { 
                const newChat = { id: Date.now(), name: matchData.name, image: matchData.images[0], lastMessage: "Вы пара!", messages: [], online: true, time: "1 сек", unreadCount: 0, isNew: true };
                setChats([newChat, ...chats]);
                setMatchData(null); 
                setActiveTab('chats');
                openChat(newChat);
              }} className="w-full bg-white text-black p-5 rounded-[24px] font-black uppercase tracking-widest flex items-center justify-center gap-3"><MessageSquare size={20}/> Написать</button>
              <button onClick={() => { setMatchData(null); handleNext(); }} className="w-full bg-white/10 text-white p-5 rounded-[24px] font-black uppercase tracking-widest border border-white/10">Позже</button>
            </div>
          </div>
        )}

        {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ СОБЫТИЯ */}
        {showEventModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center px-6">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setShowEventModal(false)} />
            <div className="relative w-full max-w-md bg-[#1c1c1e]/95 border border-white/10 p-8 rounded-[32px] shadow-2xl backdrop-blur-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black uppercase italic">Создать событие</h2>
                <button onClick={() => setShowEventModal(false)} className="p-2 bg-white/5 rounded-xl">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 mb-1.5 ml-1 uppercase tracking-widest">Название *</label>
                  <input 
                    type="text" 
                    value={newEvent.title}
                    onChange={(e) => setNewEvent({...newEvent, title: e.target.value})}
                    className={`w-full bg-white/5 border ${showEventErrors && !newEvent.title ? 'border-red-500/50' : 'border-white/10'} rounded-2xl p-4 text-sm outline-none focus:border-orange-500`}
                    placeholder="Ночной прохват"
                  />
                  {showEventErrors && !newEvent.title && <p className="text-[9px] text-red-500 font-bold uppercase mt-1 ml-1">Введите название события</p>}
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 mb-1.5 ml-1 uppercase tracking-widest">Описание</label>
                  <textarea 
                    value={newEvent.description}
                    onChange={(e) => setNewEvent({...newEvent, description: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 h-24 text-sm outline-none focus:border-orange-500 resize-none"
                    placeholder="Описание события..."
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">Дата *</label>
                    <div className={`flex items-center gap-3 bg-white/5 border ${showEventErrors && !newEvent.date ? 'border-red-500/50' : 'border-white/10'} rounded-2xl p-4`}>
                      <Calendar size={18} className="text-zinc-400 flex-shrink-0" />
                      <input 
                        type="date" 
                        value={newEvent.date}
                        onChange={(e) => setNewEvent({...newEvent, date: e.target.value})}
                        className="flex-1 bg-transparent text-sm outline-none text-white placeholder-zinc-500"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">Время *</label>
                    <div className={`flex items-center gap-3 bg-white/5 border ${showEventErrors && !newEvent.time ? 'border-red-500/50' : 'border-white/10'} rounded-2xl p-4`}>
                      <Clock size={18} className="text-zinc-400 flex-shrink-0" />
                      <input 
                        type="time" 
                        value={newEvent.time}
                        onChange={(e) => setNewEvent({...newEvent, time: e.target.value})}
                        className="flex-1 bg-transparent text-sm outline-none text-white placeholder-zinc-500"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                    <label className="block text-[10px] font-black text-zinc-500 mb-1.5 ml-1 uppercase tracking-widest">Место встречи *</label>
                    <div className={`border ${showEventErrors && !newEvent.address ? 'border-red-500/50' : 'border-transparent'} rounded-2xl`}>
                      <AddressAutocomplete
                        value={newEvent.address}
                        onChange={(result) => {
                          const normalized = typeof result === 'string'
                            ? { address: result, coordinates: null }
                            : (result || { address: '', coordinates: null });
                          setNewEvent((prev) => ({
                            ...prev,
                            address: normalized.address || '',
                            latitude: normalized.coordinates?.lat ?? null,
                            longitude: normalized.coordinates?.lon ?? null,
                          }));
                        }}
                        city={userData?.city || ''}
                        placeholder="Адрес события..."
                      />
                    </div>
                    {showEventErrors && !newEvent.address && <p className="text-[9px] text-red-500 font-bold uppercase ml-1">Укажите адрес на карте</p>}
                  </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 mb-1.5 ml-1 uppercase tracking-widest">Ссылка на организатора</label>
                  <input 
                    type="url" 
                    value={newEvent.link}
                    onChange={(e) => setNewEvent({...newEvent, link: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm outline-none focus:border-orange-500"
                    placeholder="https://vk.com/event или https://t.me/event"
                  />
                </div>
                
                {showEventErrors && (!newEvent.title || !newEvent.date || !newEvent.time || !newEvent.address) && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mt-2">
                    <p className="text-[10px] text-red-500 font-bold uppercase text-center">
                      Осталось заполнить: {[
                        !newEvent.title && "Название",
                        !newEvent.date && "Дата",
                        !newEvent.time && "Время",
                        !newEvent.address && "Место"
                      ].filter(Boolean).join(", ")}
                    </p>
                  </div>
                )}

                <button 
                  onClick={() => {
                    if (!newEvent.title || !newEvent.date || !newEvent.time || !newEvent.address) {
                      setShowEventErrors(true);
                      return;
                    }
                    createEvent();
                  }}
                  className="w-full bg-orange-600 p-5 rounded-[24px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all mt-4"
                >
                  Создать событие
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW PROFILE MODAL */}
        {viewingProfileLoading && (
          <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center animate-in fade-in duration-200">
            <div className="w-full max-w-md h-full bg-black relative flex flex-col shadow-2xl overflow-hidden sm:rounded-[32px] sm:h-[90vh] sm:border sm:border-white/10">
              <div className="flex items-center gap-4 mb-4 p-4 shrink-0 z-10">
                <div className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
                <div className="h-5 w-28 bg-white/5 rounded-lg animate-pulse" />
              </div>
              <div className="flex-1 overflow-y-auto pb-20 scrollbar-hide px-4">
                <div className="relative aspect-[3/4] overflow-hidden mb-4 rounded-[24px] bg-white/5 animate-pulse" />
                <div className="space-y-3">
                  <div className="h-6 w-2/3 bg-white/5 rounded-lg animate-pulse" />
                  <div className="h-4 w-1/2 bg-white/5 rounded-lg animate-pulse" />
                  <div className="h-20 w-full bg-white/5 rounded-[24px] animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        )}
        {viewingProfile && !viewingProfileLoading && (
          <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center animate-in fade-in duration-200">
             <div className="w-full max-w-md h-full bg-black relative flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-300 sm:rounded-[32px] sm:h-[90vh] sm:border sm:border-white/10">
                <div className="flex items-center gap-4 mb-4 p-4 shrink-0 z-10">
                  <button onClick={() => setViewingProfile(null)} className="p-2 bg-white/5 rounded-xl backdrop-blur-md"><ChevronLeft size={24}/></button>
                  <h2 className="text-xl font-black uppercase italic">Анкета</h2>
                </div>
              
                <div className="flex-1 overflow-y-auto pb-20 scrollbar-hide">
                  <div className="relative aspect-[3/4] overflow-hidden mb-4">
                    <img 
                      src={viewingProfile.images && viewingProfile.images.length > 0 ? viewingProfile.images[0] : DEFAULT_AVATAR} 
                      className="w-full h-full object-cover" 
                      alt="" 
                    />
                    <div 
                      className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none"
                      style={{ height: '60%', background: 'linear-gradient(0deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.8) 25%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0) 100%)' }}
                    />
                    <div className="absolute bottom-0 left-0 p-8 w-full z-30">
                      <h2 className="text-4xl font-black uppercase italic leading-none mb-2">{viewingProfile.name}</h2>
                      <div className="flex items-center gap-2 text-zinc-300 font-medium mb-2">
                        <MapPin size={16} className="text-orange-500" />
                        <span className="uppercase tracking-widest text-xs">{viewingProfile.city || 'Не указан'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Zap size={16} className="text-orange-500 fill-orange-500 drop-shadow-2xl" />
                        <p className="text-orange-500 text-sm font-bold uppercase tracking-widest drop-shadow-2xl">{viewingProfile.has_bike ? viewingProfile.bike : "Ищу того, кто прокатит"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {viewingProfile.interests && viewingProfile.interests.map((item) => (
                      <div key={item.id} className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-orange-500">
                          {item.icon}
                        </div>
                        <div>
                          <div className="text-[9px] uppercase font-black text-zinc-500 tracking-wider mb-0.5">{item.label}</div>
                          <div className="font-bold text-sm">{item.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {viewingProfile.about && (
                    <div className="bg-white/5 border border-white/10 p-6 rounded-[32px] mb-4">
                      <div className="text-[10px] uppercase font-black text-zinc-500 tracking-wider mb-3 flex items-center gap-2">
                        <Info size={14} />
                        О себе
                      </div>
                      <p className="text-zinc-300 leading-relaxed font-medium">{viewingProfile.about}</p>
                    </div>
                  )}
                  
                  {viewingProfile.images && viewingProfile.images.length > 1 && (
                     <div className="space-y-4 mb-4">
                        {viewingProfile.images.slice(1).map((img, idx) => (
                           <div key={idx} className="rounded-[32px] overflow-hidden border border-white/10">
                              <img src={img} className="w-full h-full object-cover" alt="" />
                           </div>
                        ))}
                     </div>
                  )}
              </div>
           </div>
          </div>
        )}
      </main>

      <nav className="h-24 shrink-0 flex items-start justify-center px-4 relative z-40">
        <div className="w-full max-w-sm h-16 bg-[#1c1c1e]/90 backdrop-blur-3xl border border-white/10 rounded-[32px] flex items-center justify-around shadow-2xl">
              <button onClick={() => {
                if (shouldEnforceProfileLock) {
                  setActiveTab('profile');
                  setShowWelcomeModal(true);
                  return;
                }
                setActiveTab('search'); 
                setSelectedChat(null); 
                setMatchData(null); 
                setSwipedChatId(null); 
                setShowSettings(false); 
                setShowAppSettings(false); 
                setNewEvent({ title: '', description: '', date: '', time: '', address: '', link: '', latitude: null, longitude: null });
                setShowEventModal(false);
              }} className={`flex flex-col items-center gap-1 transition-colors active:scale-95 ${activeTab === 'search' ? 'text-orange-500' : 'text-zinc-600'}`}><Search size={22}/><span className="text-[9px] font-black uppercase">Поиск</span></button>
          <button onClick={() => {
                if (shouldEnforceProfileLock) {
                  setActiveTab('profile');
                  setShowWelcomeModal(true);
                  return;
                }
                setActiveTab('map'); 
                setSelectedChat(null); 
                setMatchData(null); 
                setSwipedChatId(null); 
                setShowSettings(false); 
                setShowAppSettings(false); 
                setShowEventModal(false);
              }} className={`flex flex-col items-center gap-1 transition-colors active:scale-95 ${activeTab === 'map' ? 'text-orange-500' : 'text-zinc-600'}`}><MapPin size={22}/><span className="text-[9px] font-black uppercase">Карта</span></button>
          <button onClick={() => {
                if (shouldEnforceProfileLock) {
                  setActiveTab('profile');
                  setShowWelcomeModal(true);
                  return;
                }
                setActiveTab('chats'); 
                setSelectedChat(null); 
                setMatchData(null); 
                setHasNewMatchNotification(false); 
                setSwipedChatId(null); 
                setShowSettings(false); 
                setShowAppSettings(false); 
                setShowEventModal(false);
              }} className={`flex flex-col items-center gap-1 relative transition-colors active:scale-95 ${activeTab === 'chats' ? 'text-orange-500' : 'text-zinc-600'}`}>
              <MessageCircle size={22}/>
              <span className="text-[9px] font-black uppercase">Чаты</span>
              {hasNewMatchNotification && <div className="absolute top-0 right-1 w-2 h-2 bg-orange-600 rounded-full border-2 border-[#1c1c1e]" />}
          </button>
          <button onClick={() => {
                setActiveTab('profile'); 
                setSelectedChat(null); 
                setMatchData(null); 
                setSwipedChatId(null); 
                setShowSettings(false); 
                setShowAppSettings(false); 
                setShowEventModal(false);
              }} className={`flex flex-col items-center gap-1 transition-colors active:scale-95 ${activeTab === 'profile' ? 'text-orange-500' : 'text-zinc-600'}`}><User size={22}/><span className="text-[9px] font-black uppercase">Профиль</span></button>
      </div>
    </nav>
      
      {/* МОДАЛЬНОЕ ОКНО ПРИВЕТСТВИЯ НОВОГО ПОЛЬЗОВАТЕЛЯ */}
      {showWelcomeModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => {
              if (profileCompleted) {
                setShowWelcomeModal(false);
              }
            }}
          />
          
          {/* Modal */}
          <div className="relative w-full max-w-md bg-[#1c1c1e] border border-white/10 rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Close button */}
            <button 
              onClick={() => {
                if (profileCompleted) {
                  setShowWelcomeModal(false);
                }
              }}
              className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-all z-10"
            >
              <X size={20} />
            </button>
            
            <div className="p-8 text-center">
              <h2 className="text-2xl font-black italic uppercase tracking-tight mb-4">
                Приветствуем в <span className="text-orange-500">МОТОЗНАКОМСТВА</span>
              </h2>
              
              <p className="text-zinc-300 text-lg leading-relaxed mb-8">
                Добавьте фотографии и заполните профиль, чтобы найти интересных байкеров в вашем городе!
              </p>
              
              <div className="space-y-4 text-left mb-8">
                <div className="flex items-center gap-3 text-zinc-400">
                  <div className="w-8 h-8 bg-orange-600/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-500 font-bold text-sm">1</span>
                  </div>
                  <span className="text-sm">Загрузите свои лучшие фото</span>
                </div>
                <div className="flex items-center gap-3 text-zinc-400">
                  <div className="w-8 h-8 bg-orange-600/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-500 font-bold text-sm">2</span>
                  </div>
                  <span className="text-sm">Расскажите о себе и своем байке</span>
                </div>
                <div className="flex items-center gap-3 text-zinc-400">
                  <div className="w-8 h-8 bg-orange-600/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-500 font-bold text-sm">3</span>
                  </div>
                  <span className="text-sm">Начните искать единомышленников</span>
                </div>
              </div>
              
              <button 
                onClick={() => {
                  setActiveTab('profile');
                  setTimeout(() => {
                    // Закрываем welcome modal и открываем настройки
                    setShowWelcomeModal(false);
                    setTimeout(() => {
                      const editButton = document.querySelector('[data-edit-profile="true"]');
                      if (editButton) {
                        editButton.click();
                      }
                    }, 100);
                  }, 100);
                }}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-4 rounded-2xl shadow-[0_20px_40px_-15px_rgba(234,88,12,0.3)] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                Заполнить профиль
                <ArrowRight size={20} />
              </button>
              
              {profileCompleted && (
                <button 
                  onClick={() => setShowWelcomeModal(false)}
                  className="w-full text-zinc-500 hover:text-zinc-400 text-sm mt-4 transition-colors"
                >
                  Позже
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* МОДАЛЬНОЕ ОКНО УЧАСТНИКОВ ГРУППОВОГО ЧАТА */}
      {showParticipants && selectedGroupChat && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => setShowParticipants(false)}
          />
          <div className="relative w-full max-w-md bg-[#1c1c1e]/95 border border-white/10 rounded-[32px] shadow-2xl backdrop-blur-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h3 className="text-xl font-black text-white uppercase italic">Участники чата</h3>
              <button 
                onClick={() => setShowParticipants(false)}
                className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
              >
                <X size={20} className="text-white" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {selectedGroupChat.group_chat_participants?.map((participant) => (
                  <div key={participant.user_id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors w-full text-left group">
                    <button
                      onClick={async () => {
                        if (participant.user) {
                          await openUserProfile(participant.user.id);
                          setShowParticipants(false);
                        }
                      }}
                      className="w-10 h-10 rounded-full bg-gradient-to-tr from-orange-600 to-yellow-500 flex items-center justify-center group-hover:scale-110 transition-transform"
                    >
                      {participant.user?.image ? (
                        <img src={participant.user.image} alt={participant.user.name} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <User size={16} className="text-white" />
                      )}
                    </button>
                    <div className="flex-1">
                      <span className="text-sm text-white font-medium block">
                        {participant.user?.name || 'Пользователь'}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {participant.user?.age ? `${participant.user.age} лет` : ''}
                      </span>
                    </div>
                    <ChevronRight size={16} className="text-zinc-400 group-hover:text-white transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО ПРОСМОТРА ФОТО */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="relative max-w-4xl max-h-full w-full h-full flex items-center justify-center">
            {/* Кнопка предыдущего фото */}
            {imageContext.images.length > 1 && (
              <button 
                onClick={() => navigateImage('prev')}
                className="absolute left-4 p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-all"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            
            <img 
              src={selectedImage} 
              alt="Full size photo" 
              className="max-w-full max-h-full object-contain rounded-lg"
            />
            
            {/* Кнопка следующего фото */}
            {imageContext.images.length > 1 && (
              <button 
                onClick={() => navigateImage('next')}
                className="absolute right-4 p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-all"
              >
                <ChevronRight size={24} />
              </button>
            )}
            
            {/* Кнопка закрытия */}
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-all"
            >
              <X size={24} />
            </button>
            
            {/* Индикатор текущего фото */}
            {imageContext.images.length > 1 && (
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
                {imageContext.images.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2 h-2 rounded-full transition-all ${
                      index === imageContext.currentIndex 
                        ? 'bg-orange-500 w-6' 
                        : 'bg-white/50'
                    }`}
                  />
                ))}
              </div>
            )}
            
            {/* Информация о фото */}
            <div className="absolute bottom-4 left-4 text-white/70 text-sm">
              {imageContext.images.length > 0 ? `${imageContext.currentIndex + 1} / ${imageContext.images.length}` : ''}
            </div>
          </div>
        </div>
      )}
      
      {/* Стили для скрытия скроллбара */}
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}

export default MainApp;
