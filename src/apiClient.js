// API Client for MotoMate Yandex Cloud Backend

const RAW_API_BASE_URL = import.meta.env.VITE_API_URL;

function normalizeApiBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!trimmed) return '/api';
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

const API_BASE_URL = normalizeApiBaseUrl(RAW_API_BASE_URL);

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('motomate_token');
    this.errorHandler = null;
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('motomate_token', token);
  }

  removeToken() {
    this.token = null;
    localStorage.removeItem('motomate_token');
  }

  setErrorHandler(handler) {
    this.errorHandler = typeof handler === 'function' ? handler : null;
  }

  handleHttpError(status, errorData = {}) {
    const fallbackMessage = `Ошибка HTTP: ${status}`;
    const message = errorData.error || fallbackMessage;
    const normalized = { status, message };

    if (status === 401 || status === 403) {
      this.removeToken();
      normalized.message = 'Сессия истекла. Войдите снова.';
      window.dispatchEvent(new CustomEvent('motomate:sessionExpired'));
    } else if (status >= 500 && !errorData.error) {
      normalized.message = 'Ошибка сервера. Попробуйте позже.';
    }

    if (this.errorHandler) {
      this.errorHandler(normalized);
    } else if (status >= 500 || status === 401 || status === 403) {
      window.alert(normalized.message);
    }

    return normalized;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    if (this.token) {
      config.headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const normalized = this.handleHttpError(response.status, errorData);
        const error = new Error(normalized.message);
        error.status = normalized.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  // Auth methods
  async yandexAuth(code) {
    const data = await this.request('/auth/yandex', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    this.setToken(data.token);
    return data;
  }

  async emailRegister(email, password, agreements = {}) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ 
        email, 
        password,
        agreed_privacy: agreements.agreed_privacy || false,
        agreed_cookies: agreements.agreed_cookies || false,
        agreed_license: agreements.agreed_license || false,
      }),
    });
    this.setToken(data.token);
    return data;
  }

  async emailLogin(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async vkAuth(code, redirectUri) {
    const data = await this.request('/auth/vk', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    });
    this.setToken(data.token);
    return data;
  }

  // User methods
  async getProfile() {
    return this.request('/users/profile');
  }

  async getUserById(userId) {
    return this.request(`/users/${userId}`);
  }

  async updateProfile(profileData) {
    return this.request('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  }

  async updateEmail(newEmail, currentPassword) {
    const data = await this.request('/users/email', {
      method: 'PUT',
      body: JSON.stringify({
        new_email: newEmail,
        current_password: currentPassword,
      }),
    });
    if (data?.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async updatePassword(currentPassword, newPassword) {
    return this.request('/users/password', {
      method: 'PUT',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  async deleteMyAccount() {
    return this.request('/users/me', {
      method: 'DELETE',
    });
  }

  async getUsers(params = {}) {
    const searchParams = new URLSearchParams(params);
    return this.request(`/users?${searchParams}`);
  }

  // Chat methods
  async getChats() {
    return this.request('/chats');
  }

  async getChatMessages(chatId) {
    return this.request(`/chats/${chatId}/messages`);
  }

  async sendMessage(chatId, messageData) {
    return this.request(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify(messageData),
    });
  }

  // Likes methods
  async toggleLike(toUserId) {
    return this.request('/likes', {
      method: 'POST',
      body: JSON.stringify({ to_user_id: toUserId }),
    });
  }

  async getMatches() {
    return this.request('/likes/matches');
  }

  async getSentLikes() {
    return this.request('/likes/sent');
  }

  // Events methods
  async getEvents(params = {}) {
    const searchParams = new URLSearchParams(params);
    return this.request(`/events?${searchParams}`);
  }

  async createEvent(eventData) {
    return this.request('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    });
  }

  async deleteEvent(eventId) {
    return this.request(`/events/${eventId}`, {
      method: 'DELETE',
    });
  }

  // Upload methods
  async subscribePush(subscription) {
    const keys = subscription.toJSON().keys;
    return this.request('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh_key: keys.p256dh,
        auth_key: keys.auth,
      }),
    });
  }

  async sendPush(pushData) {
    return this.request('/push/send', {
      method: 'POST',
      body: JSON.stringify(pushData),
    });
  }

  // Upload method
  async uploadImage(imageData, fileName, oldUrl = null) {
    return this.request('/upload', {
      method: 'POST',
      body: JSON.stringify({ image: imageData, fileName, oldUrl }),
    });
  }

  // Health check
  async healthCheck() {
    return this.request('/health');
  }
}

export const apiClient = new ApiClient();