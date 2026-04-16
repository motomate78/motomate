import { apiClient } from './apiClient';

// Функция для сжатия изображений
export const compressImage = (file, maxWidth = 800, maxHeight = 800, quality = 0.8) => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // Вычисляем новые размеры с сохранением пропорций
      let { width, height } = img;
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Рисуем сжатое изображение
      ctx.drawImage(img, 0, 0, width, height);
      
      // Конвертируем в blob с указанным качеством
      canvas.toBlob(
        (blob) => {
          // Создаем новый File из blob
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(compressedFile);
        },
        'image/jpeg',
        quality
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
};

// Функции для работы с пользователями
export const userService = {
  // Получение всех пользователей
  async getAllUsers() {
    try {
      const data = await apiClient.getUsers();
      return data;
    } catch (error) {
      throw error;
    }
  },

  // Получение пользователя по ID
  async getUserById(userId) {
    try {
      const users = await apiClient.getUsers();
      const user = users.find(u => u.id === userId);
      if (!user) throw new Error('Пользователь не найден');
      return user;
    } catch (error) {
      throw error;
    }
  },

  // Создание нового пользователя (через OAuth)
  async createUser(userData) {
    // Пользователи создаются через OAuth процесс
    console.log('Создание пользователя выполняется через OAuth');
    return null;
  },

  // Обновление пользователя
  async updateUser(userId, userData) {
    try {
      const data = await apiClient.updateProfile(userData);
      return data;
    } catch (error) {
      throw error;
    }
  },

  // Загрузка аватара в Yandex S3
  async uploadAvatar(userId, file, oldUrl = null) {
    console.log('Original file size:', (file.size / 1024 / 1024).toFixed(2) + ' MB');
    
    // Сжимаем изображение перед загрузкой
    const compressedFile = await compressImage(file, 800, 800, 0.8);
    console.log('Compressed file size:', (compressedFile.size / 1024 / 1024).toFixed(2) + ' MB');
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const imageData = e.target.result;
          const fileName = `avatar_${userId}.jpg`;
          const result = await apiClient.uploadImage(imageData, fileName, oldUrl);
          
          // Обновляем ссылку на фото в профиле пользователя
          await this.updateUser(userId, { image: result.url });
          
          resolve(result.url);
        } catch (error) {
          console.error("Error uploading avatar:", error);
          reject(error);
        }
      };
      reader.readAsDataURL(compressedFile);
    });
  },

  // Загрузка фото в галерею
  async uploadGalleryImage(userId, file) {
    console.log('Original gallery file size:', (file.size / 1024 / 1024).toFixed(2) + ' MB');
    
    // Сжимаем изображение перед загрузкой
    const compressedFile = await compressImage(file, 1200, 1200, 0.7);
    console.log('Compressed gallery file size:', (compressedFile.size / 1024 / 1024).toFixed(2) + ' MB');
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const imageData = e.target.result;
          const fileName = `gallery_${userId}_${Date.now()}.jpg`;
          const result = await apiClient.uploadImage(imageData, fileName);
          resolve(result.url);
        } catch (error) {
          console.error("Error uploading gallery image:", error);
          reject(error);
        }
      };
      reader.readAsDataURL(compressedFile);
    });
  }
};

// Функции для работы с чатами
export const chatService = {
  // Создание нового чата
  async createChat(participant1Id, participant2Id) {
    try {
      const chats = await apiClient.getChats();
      const existingChat = chats.find(chat => 
        (chat.participant_1_id === participant1Id && chat.participant_2_id === participant2Id) ||
        (chat.participant_1_id === participant2Id && chat.participant_2_id === participant1Id)
      );
      
      if (existingChat) {
        return existingChat;
      }
      
      // Создание чата будет на бэкенде при отправке первого сообщения
      console.log('Chat will be created on backend when first message is sent');
      return null;
    } catch (error) {
      throw error;
    }
  },

  // Получение чатов пользователя
  async getUserChats(userId) {
    try {
      const chats = await apiClient.getChats();
      return chats;
    } catch (error) {
      throw error;
    }
  },

  // Отправка сообщения
  async sendMessage(chatId, messageData) {
    try {
      const data = await apiClient.sendMessage(chatId, messageData);
      return data;
    } catch (error) {
      throw error;
    }
  },

  // Получение сообщений чата
  async getChatMessages(chatId) {
    try {
      const data = await apiClient.getChatMessages(chatId);
      return data;
    } catch (error) {
      throw error;
    }
  },

  // Подписка на новые сообщения (заглушка для реального времени)
  subscribeToMessages(chatId, callback) {
    // Заглушка - реальное время через WebSocket
    return {
      unsubscribe: () => console.log('Unsubscribed from messages')
    };
  }
};

// Функции для работы с событиями
export const eventService = {
  // Создание события
  async createEvent(eventData) {
    console.log('🔥 createEvent начал работу с данными:', eventData);
    
    try {
      const data = await apiClient.createEvent(eventData);
      console.log('✅ Событие создано:', data);
      return data;
    } catch (error) {
      console.error('💥 Критическая ошибка в createEvent:', error);
      throw error;
    }
  },

  // Получение событий города
  async getCityEvents(city) {
    try {
      const data = await apiClient.getEvents({ city });
      return data;
    } catch (error) {
      throw error;
    }
  },

  // Получение всех событий
  async getAllEvents() {
    try {
      const data = await apiClient.getEvents();
      return data;
    } catch (error) {
      throw error;
    }
  }
};

// Функции для работы с групповыми чатами
export const groupChatService = {
  // Присоединение к групповому чату (заглушка)
  async joinGroupChat(groupChatId, userId) {
    console.log('Групповые чаты пока не поддерживаются');
    return null;
  },

  // Выход из группового чата (заглушка)
  async leaveGroupChat(groupChatId, userId) {
    console.log('Групповые чаты пока не поддерживаются');
    return true;
  },

  // Получение участников группового чата (заглушка)
  async getGroupChatParticipants(groupChatId) {
    console.log('Групповые чаты пока не поддерживаются');
    return [];
  },

  // Проверка, состоит ли пользователь в групповом чате (заглушка)
  async isUserInGroupChat(groupChatId, userId) {
    console.log('Групповые чаты пока не поддерживаются');
    return null;
  },

  // Получение сообщений группового чата (заглушка)
  async getGroupChatMessages(groupChatId) {
    console.log('Групповые чаты пока не поддерживаются');
    return [];
  },

  // Отправка сообщения в групповой чат (заглушка)
  async sendGroupMessage(groupChatId, messageData) {
    console.log('Групповые чаты пока не поддерживаются');
    return null;
  },

  // Подписка на сообщения группового чата (заглушка)
  subscribeToGroupMessages(groupChatId, callback) {
    return {
      unsubscribe: () => console.log('Unsubscribed from group messages')
    };
  },

  // Получение информации о групповом чате (заглушка)
  async getGroupChat(groupChatId) {
    console.log('Групповые чаты пока не поддерживаются');
    return null;
  }
};
