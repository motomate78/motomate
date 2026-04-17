import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../apiClient';
import { Gauge, Music, Shield, Target } from 'lucide-react';
import { io as socketIo } from 'socket.io-client';

const ApiManager = ({ userData, onUsersLoaded, onChatsLoaded, onEventsLoaded }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const typingChannelsRef = useRef({});
  const wsConnections = useRef({});
  const chatsPollIntervalRef = useRef(null);
  const socketRef = useRef(null);
  const socketFallbackTimerRef = useRef(null);
  const usersLoadingRef = useRef(false);
  const chatsLoadingRef = useRef(false);
  const eventsLoadingRef = useRef(false);
  const isSocketConnectedRef = useRef(false);
  const resolveApiOrigin = () => {
    const raw = String(import.meta.env.VITE_API_URL || '').trim();
    if (!raw) return window.location.origin;
    return raw.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  };

  // Getting user geolocation
  const getUserLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Геолокация не поддерживается'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000 // 5 minutes
        }
      );
    });
  };

  // Update user location
  const updateUserLocation = async () => {
    try {
      const location = await getUserLocation();
      await apiClient.updateProfile({
        latitude: location.latitude,
        longitude: location.longitude,
        location_updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error updating location:', err);
    }
  };

  // Load users for search with caching
  const loadUsers = useCallback(async () => {
    if (!userData) return;
    if (usersLoadingRef.current) return;
    usersLoadingRef.current = true;
    
    try {
      // Check cache for 5 minutes
      const cacheKey = `users_${userData.city}_${userData.gender}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < 5 * 60 * 1000) { // 5 minutes
          onUsersLoaded(data);
          return;
        }
      }

      // Get users from API
      const response = await apiClient.getUsers({
        city: userData.city,
        gender: userData.gender === 'male' ? 'female' : 'male'
      });
      
      // Handle both old array format and new {users, total, page, limit} format
      const users = Array.isArray(response) ? response : (response.users || []);
      
      // Parse images for all users (handle both array and JSON string format)
      const usersWithParsedImages = users.map(user => {
        let images = user.images;
        if (typeof images === 'string') {
          try {
            images = JSON.parse(images);
          } catch (e) {
            images = [];
          }
        }
        return { ...user, images: images || [] };
      });
      
      // Get chats to exclude already known users
      const chats = await apiClient.getChats();
      const matchedIds = chats?.map(chat => 
        chat.participant_1_id === localStorage.getItem('userId') ? chat.participant_2_id : chat.participant_1_id
      ) || [];
      
      // Exclude users already liked by current user (not only reciprocal matches)
      const sentLikes = await apiClient.getSentLikes();
      const likedIds = Array.isArray(sentLikes) ? sentLikes : [];
      
      // Filter users
      const filteredUsers = usersWithParsedImages.filter(user => 
        !matchedIds.includes(user.id) && 
        !likedIds.includes(user.id)
      );
      
      // Cache results
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: filteredUsers
      }));
      
      onUsersLoaded(filteredUsers);
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Не удалось загрузить анкеты');
    } finally {
      usersLoadingRef.current = false;
    }
  }, [onUsersLoaded, userData]);

  // Load chats
  const loadChats = useCallback(async () => {
    if (chatsLoadingRef.current) return;
    chatsLoadingRef.current = true;
    try {
      const chats = await apiClient.getChats();
      const currentUserId = localStorage.getItem('userId');
      
      const chatsWithMessages = await Promise.all(
        chats.map(async (chat) => {
          try {
            const messages = await apiClient.getChatMessages(chat.id);
            return { ...chat, messages };
          } catch (err) {
            console.error('Error loading messages for chat:', chat.id);
            return { ...chat, messages: [] };
          }
        })
      );
      
      // Sort by last message time
      const sortedChats = chatsWithMessages.sort((a, b) => 
        new Date(b.last_message_time || 0) - new Date(a.last_message_time || 0)
      );

      const toUiChat = (chat) => {
        const partner = chat.participant_1_id === currentUserId ? chat.participant2 : chat.participant1;
        const lastMsgObj = Array.isArray(chat.messages) && chat.messages.length > 0 ? chat.messages[0] : null; // backend sends desc take:1
        const lastTime = chat.last_message_time || lastMsgObj?.created_at || null;
        const lastMessage =
          chat.last_message ||
          (lastMsgObj ? (lastMsgObj.text || (lastMsgObj.type === 'image' ? 'Фото' : '—')) : '—');
        const time = lastTime
          ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(lastTime))
          : '';

        const lastSeenKey = `chat_last_seen_${chat.id}`;
        const lastSeen = Number(localStorage.getItem(lastSeenKey) || 0);
        const lastTimeMs = lastTime ? new Date(lastTime).getTime() : 0;
        const isUnread = lastMsgObj && lastMsgObj.sender_id !== currentUserId && lastTimeMs > lastSeen;

        return {
          id: chat.id,
          partnerId: partner?.id,
          name: partner?.name || 'Пользователь',
          image: partner?.image,
          lastMessage,
          time,
          last_message_time: lastTime,
          unreadCount: isUnread ? 1 : 0,
          messages: chat.messages || [],
          online: false,
          canSendMessage: true,
        };
      };

      onChatsLoaded(sortedChats.map(toUiChat));
    } catch (err) {
      console.error('Error loading chats:', err);
      setError('Не удалось загрузить чаты');
    } finally {
      chatsLoadingRef.current = false;
    }
  }, [onChatsLoaded]);

  // Load events
  const loadEvents = useCallback(async () => {
    if (eventsLoadingRef.current) return;
    eventsLoadingRef.current = true;
    try {
      const events = await apiClient.getEvents({ city: userData?.city });

      // Filter future events only
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const futureEvents = events.filter(event => {
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate >= today;
      });

      onEventsLoaded(futureEvents);

      // Load user's participations
      const participationPromises = futureEvents.map(async (event) => {
        try {
          const isParticipant = await apiClient.isEventParticipant(event.id);
          return { eventId: event.id, isParticipant: !!isParticipant };
        } catch (error) {
          console.error('Error checking participation for event:', event.id, error);
          return { eventId: event.id, isParticipant: false };
        }
      });

      const participations = await Promise.all(participationPromises);
      const participationSet = new Set(
        participations.filter(p => p.isParticipant).map(p => p.eventId)
      );

      // Dispatch event to update MainApp state
      window.dispatchEvent(new CustomEvent('motomate:eventParticipationsLoaded', {
        detail: participationSet
      }));
    } catch (err) {
      console.error('Error loading events:', err);
      setError('Не удалось загрузить события');
    } finally {
      eventsLoadingRef.current = false;
    }
  }, [onEventsLoaded, userData?.city]);

  // Re-load events when city changes
  useEffect(() => {
    if (userData?.city) {
      loadEvents();
    }
  }, [userData?.city, loadEvents]);

  // WebSocket connection for real-time updates
  const connectWebSocket = (type, callback) => {
    const origin = resolveApiOrigin();
    const wsOrigin = origin.startsWith('https://')
      ? origin.replace('https://', 'wss://')
      : origin.startsWith('http://')
        ? origin.replace('http://', 'ws://')
        : origin;
    const wsUrl = `${wsOrigin}/ws/${type}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log(`WebSocket connected for ${type}`);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      callback(data);
    };
    
    ws.onerror = (error) => {
      console.error(`WebSocket error for ${type}:`, error);
    };
    
    ws.onclose = () => {
      console.log(`WebSocket disconnected for ${type}`);
      // Reconnect after 5 seconds
      setTimeout(() => connectWebSocket(type, callback), 5000);
    };
    
    wsConnections.current[type] = ws;
    return ws;
  };

  // Setup real-time subscriptions
  const setupRealtimeSubscriptions = () => {
    if (!userData) return;

    const userId = localStorage.getItem('userId');

    // Subscribe to likes
    connectWebSocket('likes', (data) => {
      console.log('New like:', data);
      if (data.to_user_id === userId) {
        // Show notification for new like
        if (window.apiManager) {
          window.apiManager.sendNotification(
            'Новый лайк!',
            `${data.from_user_name} поставил(а) вам лайк`,
            data.from_user_image || '/favicons/android-chrome-192x192.png'
          );
        }
        loadUsers(); // Refresh users list
      }
    });

    // Subscribe to messages
    connectWebSocket('messages', (data) => {
      console.log('New message:', data);
      if (data.sender_id !== userId) {
        // Show notification for new message
        if (window.apiManager) {
          window.apiManager.sendNotification(
            'Новое сообщение',
            'Вам пришло новое сообщение в чате',
            '/favicons/android-chrome-192x192.png'
          );
        }
        loadChats(); // Refresh chats
      }
    });

    // Subscribe to matches
    connectWebSocket('matches', (data) => {
      console.log('New match:', data);
      if (window.apiManager) {
        window.apiManager.sendNotification(
          'Новый мэтч!',
          `У вас мэтч с ${data.partner_name}`,
          data.partner_image || '/favicons/android-chrome-192x192.png'
        );
      }
      loadUsers(); // Refresh users list
      loadChats(); // Refresh chats
    });
  };

  // Typing indicators
  const sendTypingIndicator = (chatId, isTyping) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('typing', { chatId, isTyping: Boolean(isTyping) });
      return;
    }
    // fallback (old ws stub, if ever enabled)
    if (wsConnections.current.typing) {
      wsConnections.current.typing.send(JSON.stringify({
        type: 'typing',
        chatId,
        userId: localStorage.getItem('userId'),
        isTyping
      }));
    }
  };

  const subscribeToTyping = (chatId, callback) => {
    const handler = (ev) => {
      const data = ev.detail;
      if (data?.chatId === chatId && data.userId !== localStorage.getItem('userId')) {
        callback(data);
      }
    };
    window.addEventListener('motomate:typing', handler);
    return () => window.removeEventListener('motomate:typing', handler);
  };

  // API methods for components
  const apiMethods = {
    sendMessage: async (chatId, text, type = 'text', imageUrl = null) => {
      try {
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit('send_message', {
            chatId,
            text,
            type,
            image: imageUrl
          });
          return {
            id: `tmp_${Date.now()}`,
            chat_id: chatId,
            sender_id: localStorage.getItem('userId'),
            text,
            image: imageUrl,
            type,
            created_at: new Date().toISOString(),
          };
        }
        const message = await apiClient.sendMessage(chatId, {
          text,
          type,
          image: imageUrl
        });
        return message;
      } catch (error) {
        console.error('Error sending message:', error);
        throw error;
      }
    },

    recordLike: async (targetUserId) => {
      try {
        const result = await apiClient.toggleLike(targetUserId);
        
        if (result.isMatch) {
          // Find the chat ID from the chats list
          const chats = await apiClient.getChats();
          const currentUserId = localStorage.getItem('userId');
          const chat = chats.find(c => 
            (c.participant_1_id === currentUserId && c.participant_2_id === targetUserId) ||
            (c.participant_1_id === targetUserId && c.participant_2_id === currentUserId)
          );
          
          return { isMatch: true, chat: chat || { id: `chat_${Date.now()}` } };
        }
        
        return { isMatch: false };
      } catch (error) {
        console.error('Error recording like:', error);
        throw error;
      }
    },

    recordDislike: async (targetUserId) => {
      try {
        // For dislikes, we just remove the like if it exists
        await apiClient.toggleLike(targetUserId);
        loadUsers(); // Refresh users list
      } catch (error) {
        console.error('Error recording dislike:', error);
        throw error;
      }
    },

    createChat: async (participant1Id, participant2Id) => {
      try {
        // Chat creation is handled automatically when first message is sent
        console.log('Chat will be created when first message is sent');
        return null;
      } catch (error) {
        console.error('Error creating chat:', error);
        throw error;
      }
    },

    createEvent: async (eventData) => {
      try {
        const event = await apiClient.createEvent(eventData);
        loadEvents(); // Refresh events
        return event;
      } catch (error) {
        console.error('Error creating event:', error);
        throw error;
      }
    },

    loadEvents: async () => {
      await loadEvents();
    },

    loadUsers: async () => {
      await loadUsers();
    },

    markMessagesAsRead: async (chatId) => {
      try {
        // This would be handled by the backend automatically
        console.log('Messages marked as read');
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    },

    markAsRead: async (chatId) => {
      try {
        // This would be handled by the backend automatically
        console.log('Chat marked as read');
      } catch (error) {
        console.error('Error marking chat as read:', error);
      }
    },

    deleteMessage: async (messageId) => {
      try {
        // Add delete method to API client if needed
        console.log('Delete message functionality not implemented yet');
      } catch (error) {
        console.error('Error deleting message:', error);
        throw error;
      }
    },

    editMessage: async (messageId, newText) => {
      try {
        // Add edit method to API client if needed
        console.log('Edit message functionality not implemented yet');
      } catch (error) {
        console.error('Error editing message:', error);
        throw error;
      }
    }
  };

  // Initialize
  useEffect(() => {
    if (!userData?.id) return undefined;

    let isDisposed = false;
    let locationInterval = null;

    const stopPolling = () => {
      if (chatsPollIntervalRef.current) {
        clearInterval(chatsPollIntervalRef.current);
        chatsPollIntervalRef.current = null;
      }
    };

    const startPollingFallback = () => {
      if (!isSocketConnectedRef.current && !chatsPollIntervalRef.current) {
        console.log('[ApiManager] Socket disconnected, starting polling fallback');
        chatsPollIntervalRef.current = setInterval(() => {
          if (!isSocketConnectedRef.current) loadChats();
        }, 7000);
      }
    };

    const stopPollingFallback = () => {
      if (chatsPollIntervalRef.current) {
        console.log('[ApiManager] Socket connected, stopping polling fallback');
        clearInterval(chatsPollIntervalRef.current);
        chatsPollIntervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      // Reserved for future optimizations (pause/resume realtime by visibility)
    };

    const enableSocket = () => {
      const token = localStorage.getItem('motomate_token');
      const origin = resolveApiOrigin();

      if (!token) {
        isSocketConnectedRef.current = false;
        startPollingFallback();
        return;
      }
      
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch {}
        socketRef.current = null;
      }

      const socket = socketIo(origin, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 10,
        timeout: 5000,
      });
      socketRef.current = socket;

      if (socketFallbackTimerRef.current) clearTimeout(socketFallbackTimerRef.current);
      socketFallbackTimerRef.current = setTimeout(() => {
        if (isSocketConnectedRef.current || isDisposed) return;
        console.warn('[ApiManager] Socket timeout, falling back to polling');
        try { socket.disconnect(); } catch {}
        startPollingFallback();
      }, 8000);

      socket.on('connect', () => {
        console.log('[ApiManager] Socket connected');
        isSocketConnectedRef.current = true;
        if (socketFallbackTimerRef.current) clearTimeout(socketFallbackTimerRef.current);
        stopPollingFallback();
        apiClient.getChats().then((chs) => {
          (chs || []).forEach((c) => socket.emit('join_room', { chatId: c.id }));
        }).catch(() => {});
      });

      socket.on('disconnect', () => {
        console.log('[ApiManager] Socket disconnected');
        isSocketConnectedRef.current = false;
        if (!isDisposed) startPollingFallback();
      });

      socket.on('connect_error', (error) => {
        console.error('[ApiManager] Socket connect error:', error?.message);
        isSocketConnectedRef.current = false;
        if (!isDisposed) startPollingFallback();
      });

      socket.on('new_message', ({ chatId, message }) => {
        window.dispatchEvent(new CustomEvent('motomate:newMessage', { detail: { chatId, message } }));
        loadChats();
      });

      socket.on('typing', ({ chatId, userId, isTyping }) => {
        window.dispatchEvent(new CustomEvent('motomate:typing', { detail: { chatId, userId, isTyping } }));
      });
    };

    const initialize = async () => {
      setLoading(true);
      setError(null);

      try {
        await Promise.all([loadUsers(), loadChats(), loadEvents()]);
        if (isDisposed) return;

        locationInterval = setInterval(updateUserLocation, 60000);
        enableSocket();
        document.addEventListener('visibilitychange', handleVisibilityChange);
      } catch (err) {
        console.error('Error initializing ApiManager:', err);
        if (!isDisposed) setError('Не удалось инициализировать данные');
      } finally {
        if (!isDisposed) setLoading(false);
      }
    };

    initialize();

    return () => {
      isDisposed = true;
      if (locationInterval) clearInterval(locationInterval);
      stopPollingFallback();
      if (socketFallbackTimerRef.current) clearTimeout(socketFallbackTimerRef.current);
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch {}
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      Object.values(wsConnections.current).forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });
    };
  }, [userData?.id, userData?.city, userData?.gender]); // Re-initialize when city or gender changes

  useEffect(() => {
    window.apiManager = {
      ...apiMethods,
      loadUsers,
      loadChats,
      loadEvents,
      sendNotification: (title, body, icon) => {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body, icon });
        }
      },
      sendTypingIndicator,
      subscribeToTyping
    };
  }, [loadUsers, loadChats, loadEvents]);

  if (loading) {
    return (
      <div className="fixed top-4 right-4 bg-orange-500/20 border border-orange-500/30 rounded-xl p-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-orange-500 text-sm font-medium">Загружаем данные...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed top-4 right-4 bg-red-500/20 border border-red-500/30 rounded-xl p-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="text-red-500 text-sm font-medium">{error}</span>
        </div>
      </div>
    );
  }

  return null; // Component only for managing data
};

export default ApiManager;
