const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { z } = require('zod');
const serverless = require('serverless-http');
const { Server: SocketIOServer } = require('socket.io');
const webpush = require('web-push');
const axios = require('axios');
require('dotenv').config();

const app = express();
const router = express.Router();
const prisma = new PrismaClient();
let io = null;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for flexibility in development
}));
app.use(morgan('combined'));

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const JWT_SECRET = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET is not set in environment');
  process.exit(1);
}

if (isProduction && !corsOrigins.length) {
  console.error('❌ FATAL: CORS_ORIGINS is not configured in production');
  process.exit(1);
}

app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic rate limiting (protects from abuse)
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));

// Route-specific anti-spam (stricter than global)
const likesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LIKES_PER_MINUTE || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const messagesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Zod schemas (critical routes)
const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).nullable().optional(),
  age: z.number().int().min(18).max(100).nullable().optional(),
  city: z.string().trim().min(1).max(80).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  bike: z.string().trim().max(120).nullable().optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
  has_bike: z.boolean().optional(),
  about: z.string().trim().max(1000).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(), // legacy
  temp: z.string().trim().max(60).nullable().optional(),
  music: z.string().trim().max(60).nullable().optional(),
  equip: z.string().trim().max(60).nullable().optional(),
  goal: z.string().trim().max(60).nullable().optional(),
  image: z.string().url().nullable().optional(),
  images: z.array(z.string().url()).max(12).optional(),
  has_seen_welcome: z.boolean().optional(),
  is_private: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
}).passthrough();

const eventCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  city: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  address: z.string().trim().max(200).nullable().optional(),
  link: z.string().url().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
}).passthrough();

const updateEmailSchema = z.object({
  new_email: z.string().email(),
  current_password: z.string().min(1).max(128),
});

const updatePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(6).max(128),
});

const messageSchema = z.object({
  text: z.string().max(5000).nullable().optional(),
  image: z.string().url().nullable().optional(),
  type: z.enum(['text', 'image']).default('text'),
});

function toNullableNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Routes prefix
app.use('/api', router);

// Socket.io (works on VM/containers; serverless handler doesn't keep WS)
function initSocketIo(server) {
  const origins = corsOrigins.length ? corsOrigins : ['*'];
  io = new SocketIOServer(server, {
    cors: {
      origin: origins,
      credentials: true,
    },
    path: '/socket.io',
  });

  // Auth via Bearer token in handshake
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1] ||
        socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorized'));
      jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return next(new Error('unauthorized'));
        socket.user = user;
        next();
      });
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join_room', async ({ chatId }) => {
      try {
        if (!chatId) return;
        const chat = await prisma.chat.findFirst({
          where: {
            id: String(chatId),
            OR: [
              { participant_1_id: socket.user.userId },
              { participant_2_id: socket.user.userId },
            ],
          },
          select: { id: true },
        });
        if (!chat) return;
        socket.join(`chat:${chat.id}`);
      } catch (e) {
        logError('socket.join_room', e, { userId: socket.user?.userId });
      }
    });

    socket.on('typing', async ({ chatId, isTyping }) => {
      if (!chatId) return;
      socket.to(`chat:${chatId}`).emit('typing', {
        chatId,
        userId: socket.user.userId,
        isTyping: Boolean(isTyping),
      });
    });

    socket.on('send_message', async ({ chatId, text, type = 'text', image = null }) => {
      try {
        if (!chatId) return;
        
        const parsed = messageSchema.safeParse({ text, image, type });
        if (!parsed.success) return;
        
        const { text: validText, image: validImage, type: validType } = parsed.data;
        
        const chat = await prisma.chat.findFirst({
          where: {
            id: String(chatId),
            OR: [
              { participant_1_id: socket.user.userId },
              { participant_2_id: socket.user.userId },
            ],
          },
        });
        if (!chat) return;

        const message = await prisma.message.create({
          data: {
            chat_id: String(chatId),
            sender_id: socket.user.userId,
            text: validText || null,
            image: validImage || null,
            type: validType,
          },
        });

        await prisma.chat.update({
          where: { id: String(chatId) },
          data: {
            last_message: (validText && String(validText).trim()) ? String(validText).trim() : 'Фото',
            last_message_time: new Date(),
          },
        });

        io.to(`chat:${chatId}`).emit('new_message', { chatId, message });
      } catch (e) {
        logError('socket.send_message', e, { userId: socket.user?.userId, chatId });
      }
    });

    socket.on('disconnect', () => {
      logError('socket.disconnect', new Error('User disconnected'), { userId: socket.user?.userId });
    });
  });
}

// Yandex S3 Configuration
const s3Client = new S3Client({
  endpoint: 'https://storage.yandexcloud.net',
  region: 'ru-central1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// WebPush Configuration
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      'mailto:support@motomate.ru',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  } catch (err) {
    console.warn('WebPush VAPID details are invalid, skipping push configuration:', err.message);
  }
}

// JWT Secret is validated above during CORS setup

function logError(context, error, extra = {}) {
  const payload = {
    level: 'error',
    context,
    message: error?.message || String(error),
    stack: error?.stack,
    ...extra,
    ts: new Date().toISOString(),
  };
  console.error(JSON.stringify(payload));
}

function normalizeNullableString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function parseEventDateTime(date, time) {
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  const timeValue = new Date(`1970-01-01T${time}:00.000Z`);
  return { dateValue, timeValue };
}

const emailRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

const emailLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const vkAuthSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

// Auth Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Helper function for upload to S3
const uploadToS3 = async (buffer, fileName, contentType) => {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  });

  try {
    await s3Client.send(command);
    return `https://storage.yandexcloud.net/${process.env.S3_BUCKET}/${fileName}`;
  } catch (error) {
    console.error('S3 Upload Error:', error);
    throw error;
  }
};

const extractS3KeyFromUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  try {
    const parsed = new URL(fileUrl);
    if (!parsed.hostname.includes('storage.yandexcloud.net')) return null;
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) return null;
    if (pathParts[0] !== process.env.S3_BUCKET) return null;
    return pathParts.slice(1).join('/');
  } catch {
    return null;
  }
};

const deleteFromS3 = async (fileUrl) => {
  const key = extractS3KeyFromUrl(fileUrl);
  if (!key) return false;

  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  });

  try {
    await s3Client.send(command);
    return true;
  } catch (error) {
    logError('s3.delete', error, { key });
    return false;
  }
};

const parseJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

// SECURITY: Validate file magic bytes (signature) to prevent file type spoofing
const validateImageMagicBytes = (buffer, mimeType) => {
  if (buffer.length < 4) return false;

  const magicBytes = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
  };

  const expectedBytes = magicBytes[mimeType];
  if (!expectedBytes) return false;

  for (let i = 0; i < expectedBytes.length; i++) {
    if (buffer[i] !== expectedBytes[i]) {
      return false;
    }
  }

  if (mimeType === 'image/webp') {
    if (buffer.length < 12) return false;
    const webpSig = buffer.slice(8, 12).toString('ascii');
    if (webpSig !== 'WEBP') return false;
  }

  return true;
};

// Auth Routes
router.post('/auth/register', async (req, res) => {
  try {
    const parsed = emailRegisterSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные регистрации', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    // Validate legal agreements
    const { agreed_privacy, agreed_cookies, agreed_license } = req.body || {};
    if (!agreed_privacy || !agreed_cookies || !agreed_license) {
      return res.status(400).json({ 
        error: 'Необходимо согласие со всеми условиями: политикой конфиденциальности, политикой использования cookie и лицензионным соглашением' 
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        auth_provider: 'email',
        // минимальные значения — дальше онбординг/профиль
        city: 'Москва',
        gender: 'male',
        // Save legal agreements (152-ФЗ compliance)
        agreed_privacy: true,
        agreed_cookies: true,
        agreed_license: true,
        agreed_at: new Date(),
      },
    });

    // Log agreement acceptance for audit trail
    console.log(`[AUDIT] User ${user.id} (${email}) accepted all agreements at ${new Date().toISOString()}`);

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        age: user.age,
        city: user.city,
        gender: user.gender,
        image: user.image,
      },
    });
  } catch (error) {
    logError('auth.register', error);
    res.status(500).json({ error: 'Регистрация не удалась' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const parsed = emailLoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные входа', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        age: user.age,
        city: user.city,
        gender: user.gender,
        image: user.image,
      },
    });
  } catch (error) {
    logError('auth.login', error);
    res.status(500).json({ error: 'Вход не удался' });
  }
});

router.post('/auth/vk', async (req, res) => {
  try {
    const parsed = vkAuthSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные VK авторизации', details: parsed.error.flatten() });
    }
    const { code, redirectUri } = parsed.data;

    if (!process.env.VK_CLIENT_ID || !process.env.VK_CLIENT_SECRET) {
      return res.status(500).json({ error: 'VK авторизация не настроена на сервере' });
    }

    const tokenUrl = new URL('https://oauth.vk.com/access_token');
    tokenUrl.searchParams.set('client_id', process.env.VK_CLIENT_ID);
    tokenUrl.searchParams.set('client_secret', process.env.VK_CLIENT_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token || !tokenData.user_id) {
      return res.status(400).json({ error: 'Не удалось получить токен VK', details: tokenData });
    }

    const accessToken = tokenData.access_token;
    const vkUserId = String(tokenData.user_id);
    const email = tokenData.email || `vk_${vkUserId}@vk.local`;

    const userInfoUrl = new URL('https://api.vk.com/method/users.get');
    userInfoUrl.searchParams.set('user_ids', vkUserId);
    userInfoUrl.searchParams.set('fields', 'photo_200,city');
    userInfoUrl.searchParams.set('v', '5.199');
    userInfoUrl.searchParams.set('access_token', accessToken);

    const infoRes = await fetch(userInfoUrl.toString());
    const infoData = await infoRes.json();
    const vkUser = infoData?.response?.[0];

    const name = vkUser ? `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim() : 'Пользователь VK';
    const image = vkUser?.photo_200 || null;

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Пользователь VK',
          city: 'Москва',
          gender: 'male',
          image,
          vk_id: vkUserId,
          auth_provider: 'vk',
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          vk_id: user.vk_id || vkUserId,
          auth_provider: user.auth_provider || 'vk',
          image: user.image || image,
        },
      });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        age: user.age,
        city: user.city,
        gender: user.gender,
        image: user.image,
      },
    });
  } catch (error) {
    logError('auth.vk', error);
    res.status(500).json({ error: 'VK авторизация не удалась' });
  }
});

router.post('/auth/yandex', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    // Exchange code for user data with Yandex ID
    const response = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: process.env.YANDEX_CLIENT_ID,
        client_secret: process.env.YANDEX_CLIENT_SECRET,
      }),
    });

    const tokenData = await response.json();
    
    if (!tokenData.access_token) {
      console.error('Yandex Token Error:', tokenData);
      return res.status(400).json({ error: 'Invalid authorization code' });
    }

    // Get user info from Yandex
    const userResponse = await fetch('https://login.yandex.ru/info', {
      headers: {
        Authorization: `OAuth ${tokenData.access_token}`,
      },
    });

    const yandexUser = await userResponse.json();
    
    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { email: yandexUser.default_email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: yandexUser.default_email,
          name: yandexUser.real_name || yandexUser.display_name || 'MotoRider',
          age: 25,
          city: 'Москва',
          gender: 'male',
          auth_provider: 'yandex',
        },
      });
    } else if (!user.auth_provider) {
      user = await prisma.user.update({ where: { id: user.id }, data: { auth_provider: 'yandex' } });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        age: user.age,
        city: user.city,
        gender: user.gender,
        image: user.image,
      },
    });
  } catch (error) {
    logError('auth.yandex', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// User Routes
router.get('/users/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse images string if SQLite is used
    if (typeof user.images === 'string') {
      try {
        user.images = JSON.parse(user.images);
      } catch (e) {
        user.images = [];
      }
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.get('/users/:id', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        age: true,
        city: true,
        address: true,
        bike: true,
        gender: true,
        has_bike: true,
        about: true,
        image: true,
        images: true,
        temp: true,
        music: true,
        equip: true,
        goal: true,
        is_private: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_private && req.params.id !== req.user.userId) {
      return res.status(403).json({ error: 'User profile is private' });
    }

    delete user.is_private;

    if (typeof user.images === 'string') {
      try {
        user.images = JSON.parse(user.images);
      } catch (e) {
        user.images = [];
      }
    }

    res.json(user);
  } catch (error) {
    console.error('Get user by id error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.put('/users/profile', authenticateToken, async (req, res) => {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { image: true, images: true },
    });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const parsed = profileUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные профиля', details: parsed.error.flatten() });
    }
    const body = parsed.data;

    // Allow-list fields to avoid Prisma "Unknown arg" errors
    const data = {
      name: body.name ?? undefined,
      age: body.age ?? undefined,
      city: body.city ?? undefined,
      address: body.address ?? undefined,
      bike: body.bike ?? undefined,
      gender: body.gender ?? undefined,
      has_bike: body.has_bike ?? undefined,
      about: (body.about ?? body.bio) ?? undefined, // tolerate legacy "bio"
      temp: body.temp ?? undefined,
      music: body.music ?? undefined,
      equip: body.equip ?? undefined,
      goal: body.goal ?? undefined,
      image: body.image ?? undefined,
      has_seen_welcome: body.has_seen_welcome ?? undefined,
      is_private: body.is_private ?? undefined,
      latitude: body.latitude ?? undefined,
      longitude: body.longitude ?? undefined,
    };

    // SQLite schema stores images as JSON string
    if (Array.isArray(body.images)) {
      data.images = JSON.stringify(body.images);
    } else if (typeof body.images === 'string') {
      data.images = body.images;
    }

    if (data.latitude != null && data.longitude != null) {
      data.location_updated_at = new Date();
    }

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
    });

    const previousImages = new Set([
      ...(existingUser.image ? [existingUser.image] : []),
      ...parseJsonArray(existingUser.images),
    ]);
    const nextImages = new Set([
      ...(user.image ? [user.image] : []),
      ...parseJsonArray(user.images),
    ]);
    const imagesToDelete = [...previousImages].filter((url) => !nextImages.has(url));
    if (imagesToDelete.length) {
      await Promise.allSettled(imagesToDelete.map((url) => deleteFromS3(url)));
    }

    res.json(user);
  } catch (error) {
    logError('users.profile.update', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/users/email', authenticateToken, async (req, res) => {
  try {
    const parsed = updateEmailSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные смены email', details: parsed.error.flatten() });
    }

    const { new_email, current_password } = parsed.data;
    const currentUser = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!currentUser) return res.status(404).json({ error: 'Пользователь не найден' });
    if (!currentUser.password_hash) return res.status(400).json({ error: 'Смена email недоступна для данного способа входа' });

    const passwordOk = await bcrypt.compare(current_password, currentUser.password_hash);
    if (!passwordOk) return res.status(401).json({ error: 'Текущий пароль указан неверно' });

    const existing = await prisma.user.findUnique({ where: { email: new_email } });
    if (existing && existing.id !== currentUser.id) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: currentUser.id },
      data: { email: new_email },
      select: { id: true, email: true },
    });

    const token = jwt.sign({ userId: updatedUser.id, email: updatedUser.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ success: true, user: updatedUser, token });
  } catch (error) {
    logError('users.email.update', error, { userId: req.user?.userId });
    return res.status(500).json({ error: 'Не удалось сменить email' });
  }
});

router.put('/users/password', authenticateToken, async (req, res) => {
  try {
    const parsed = updatePasswordSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные смены пароля', details: parsed.error.flatten() });
    }

    const { current_password, new_password } = parsed.data;
    const currentUser = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!currentUser) return res.status(404).json({ error: 'Пользователь не найден' });
    if (!currentUser.password_hash) return res.status(400).json({ error: 'Смена пароля недоступна для данного способа входа' });

    const passwordOk = await bcrypt.compare(current_password, currentUser.password_hash);
    if (!passwordOk) return res.status(401).json({ error: 'Текущий пароль указан неверно' });

    const nextHash = await bcrypt.hash(new_password, 10);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { password_hash: nextHash },
      select: { id: true },
    });

    return res.json({ success: true });
  } catch (error) {
    logError('users.password.update', error, { userId: req.user?.userId });
    return res.status(500).json({ error: 'Не удалось сменить пароль' });
  }
});

router.delete('/users/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, image: true, images: true },
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const messageImages = await prisma.message.findMany({
      where: { sender_id: userId, image: { not: null } },
      select: { image: true },
    });

    const fileUrls = new Set([
      ...(user.image ? [user.image] : []),
      ...parseJsonArray(user.images),
      ...messageImages.map((item) => item.image).filter(Boolean),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.like.deleteMany({
        where: {
          OR: [
            { from_user_id: userId },
            { to_user_id: userId },
          ],
        },
      });
      await tx.message.deleteMany({ where: { sender_id: userId } });
      await tx.event.deleteMany({ where: { created_by_id: userId } });
      await tx.pushSubscription.deleteMany({ where: { user_id: userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    const deleteResults = await Promise.allSettled([...fileUrls].map((url) => deleteFromS3(url)));
    const failedDeletes = deleteResults.filter((result) => result.status === 'rejected').length;

    return res.json({
      success: true,
      deletedFiles: fileUrls.size,
      failedFileDeletes: failedDeletes,
    });
  } catch (error) {
    logError('users.me.delete', error, { userId: req.user?.userId });
    return res.status(500).json({ error: 'Не удалось удалить аккаунт' });
  }
});

// Image endpoints
router.get('/users/profile/images', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('[users/profile/images] Request for user:', userId);

    const images = await prisma.image.findMany({
      where: { user_id: userId },
      orderBy: { order: 'asc' },
      select: { id: true, url: true, is_main: true, created_at: true },
    });

    console.log('[users/profile/images] Found images:', images.length);
    res.json({ images });
  } catch (error) {
    console.error('[users/profile/images] ERROR:', error.message, error.stack);
    logError('users.profile.images.get', error, { userId: req.user?.userId });
    // Если таблица Image не существует или другая ошибка, возвращаем пустой массив вместо 500
    res.json({ images: [] });
  }
});

router.post('/users/profile/images', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Missing imageData' });
    }

    // Parse base64 data URI
    const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const [, mimeType, base64Data] = matches;
    const buffer = Buffer.from(base64Data, 'base64');

    // Validate file size (max 5MB)
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large (max 5MB)' });
    }

    // Validate MIME type
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimeTypes.includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid image type' });
    }

    // Upload to S3
    const timestamp = Date.now();
    const fileName = `users/${userId}/images/${timestamp}.jpg`;
    const imageUrl = await uploadToS3(buffer, fileName, mimeType);

    // Save to database
    const image = await prisma.image.create({
      data: {
        user_id: userId,
        url: imageUrl,
        order: 0, // Can be updated later
      },
      select: { id: true, url: true, is_main: true, created_at: true },
    });

    res.json({ image });
  } catch (error) {
    logError('users.profile.images.post', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.delete('/users/profile/images/:imageId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { imageId } = req.params;

    const image = await prisma.image.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    if (image.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Delete from S3
    await deleteFromS3(image.url);

    // Delete from database
    await prisma.image.delete({
      where: { id: imageId },
    });

    res.json({ success: true });
  } catch (error) {
    logError('users.profile.images.delete', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

router.get('/users', authenticateToken, async (req, res) => {
  try {
    const { city, gender, page = '1', limit = '20' } = req.query;
    
    // SAFETY: Enforce max limit to prevent memory issues
    const MAX_LIMIT = 100;
    const parsedPage = Math.max(parseInt(page) || 1, 1);
    const parsedLimit = Math.min(parseInt(limit) || 20, MAX_LIMIT);
    
    const where = {
      id: { not: req.user.userId },
      is_private: false,
    };

    if (city) where.city = city;
    if (gender) where.gender = gender;

    // Query with optimized select (less memory)
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        age: true,
        city: true,
        bike: true,
        gender: true,
        has_bike: true,
        image: true,
        images: true,
        latitude: true,
        longitude: true,
      },
      skip: (parsedPage - 1) * parsedLimit,
      take: parsedLimit,
    });

    // Get total count for pagination
    const total = await prisma.user.count({ where });

    // Parse images string if SQLite is used
    const parsedUsers = users.map(u => ({
      ...u,
      images: typeof u.images === 'string' ? JSON.parse(u.images) : u.images
    }));

    res.json({ users: parsedUsers, total, page: parsedPage, limit: parsedLimit });
  } catch (error) {
    logError('users.get', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Chat Routes
router.get('/chats', authenticateToken, async (req, res) => {
  try {
    const chats = await prisma.chat.findMany({
      where: {
        OR: [
          { participant_1_id: req.user.userId },
          { participant_2_id: req.user.userId },
        ],
      },
      include: {
        participant1: {
          select: { id: true, name: true, image: true },
        },
        participant2: {
          select: { id: true, name: true, image: true },
        },
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { last_message_time: 'desc' },
    });

    res.json(chats);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

router.get('/chats/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const chat = await prisma.chat.findFirst({
      where: {
        id,
        OR: [
          { participant_1_id: req.user.userId },
          { participant_2_id: req.user.userId },
        ],
      },
    });

    if (!chat) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await prisma.message.findMany({
      where: { chat_id: id },
      orderBy: { created_at: 'asc' },
    });

    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.post('/chats/:id/messages', authenticateToken, messagesLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = messageSchema.safeParse(req.body || {});
    
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid message data', details: parsed.error.flatten() });
    }

    const { text, image, type } = parsed.data;

    const chat = await prisma.chat.findFirst({
      where: {
        id,
        OR: [
          { participant_1_id: req.user.userId },
          { participant_2_id: req.user.userId },
        ],
      },
    });

    if (!chat) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await prisma.message.create({
      data: {
        chat_id: id,
        sender_id: req.user.userId,
        text: text || null,
        image: image || null,
        type,
      },
    });

    await prisma.chat.update({
      where: { id },
      data: {
        last_message: (text && String(text).trim()) ? String(text).trim() : 'Фото',
        last_message_time: new Date(),
      },
    });

    if (io) {
      io.to(`chat:${id}`).emit('new_message', { chatId: id, message });
    }

    res.json(message);
  } catch (error) {
    logError('chats.messages.send', error, { userId: req.user?.userId, chatId: req.params?.id });
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Likes Routes
router.post('/likes', authenticateToken, likesLimiter, async (req, res) => {
  try {
    const { to_user_id } = req.body;
    const from_user_id = req.user.userId;

    console.log('[likes] Toggle like:', { from_user_id, to_user_id });

    const existingLike = await prisma.like.findUnique({
      where: {
        from_user_id_to_user_id: { from_user_id, to_user_id },
      },
    });

    console.log('[likes] Existing like:', !!existingLike);

    if (existingLike) {
      console.log('[likes] Deleting existing like');
      await prisma.like.delete({ where: { id: existingLike.id } });
      res.json({ liked: false });
    } else {
      console.log('[likes] Creating new like');
      // ATOMICITY: Use transaction to prevent race condition
      const result = await prisma.$transaction(async (tx) => {
        const newLike = await tx.like.create({ data: { from_user_id, to_user_id } });
        console.log('[likes] Like created in DB:', newLike.id);
        
        const reciprocalLike = await tx.like.findUnique({
          where: {
            from_user_id_to_user_id: {
              from_user_id: to_user_id,
              to_user_id: from_user_id,
            },
          },
        });

        console.log('[likes] Reciprocal like found:', !!reciprocalLike);

        let chatId = null;
        if (reciprocalLike) {
          chatId = [from_user_id, to_user_id].sort().join('_');
          console.log('[likes] Match! Creating chat:', chatId);
          
          // Create or update Chat
          await tx.chat.upsert({
            where: { id: chatId },
            update: {},
            create: {
              id: chatId,
              participant_1_id: from_user_id,
              participant_2_id: to_user_id,
            },
          });

          // Create or update Match
          const [user1, user2] = [from_user_id, to_user_id].sort();
          const match = await tx.match.upsert({
            where: {
              user_id_1_user_id_2: {
                user_id_1: user1,
                user_id_2: user2,
              },
            },
            update: { chat_id: chatId },
            create: {
              user_id_1: user1,
              user_id_2: user2,
              chat_id: chatId,
            },
          });
          console.log('[likes] Match created/updated:', match.id);
        }

        return { isMatch: !!reciprocalLike, chatId };
      });

      res.json({
        liked: true,
        isMatch: result.isMatch,
        chat: result.isMatch ? { id: result.chatId } : null,
      });
    }
  } catch (error) {
    console.error('[likes] ERROR:', error.message, error.stack);
    logError('likes.toggle', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to toggle like', details: error.message });
  }
});

router.get('/likes/matches', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    // Optimized: Find users who I like AND who like me
    const matches = await prisma.user.findMany({
      where: {
        AND: [
          { receivedLikes: { some: { from_user_id: userId } } },
          { sentLikes: { some: { to_user_id: userId } } }
        ]
      },
      select: {
        id: true,
        name: true,
        age: true,
        city: true,
        image: true,
      }
    });

    res.json(matches);
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ error: 'Failed to get matches' });
  }
});

router.get('/likes/sent', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sentLikes = await prisma.like.findMany({
      where: { from_user_id: userId },
      select: { to_user_id: true },
    });
    res.json(sentLikes.map((like) => like.to_user_id));
  } catch (error) {
    logError('likes.sent', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to get sent likes' });
  }
});

// Geo Proxy Routes - to avoid CORS issues with Yandex API
router.get('/geo/suggest', async (req, res) => {
  try {
    const { text, type = 'geo', results = 6, lang = 'ru_RU' } = req.query;
    const apiKey = process.env.YANDEX_API_KEY || process.env.VITE_YANDEX_API_KEY;

    console.log('[geo/suggest] Request:', { text, type, results, lang, hasApiKey: !!apiKey });

    if (!apiKey) {
      console.error('[geo/suggest] ERROR: Yandex API key not configured');
      return res.status(500).json({ error: 'Yandex API key not configured' });
    }

    if (!text || String(text).trim().length < 2) {
      return res.json({ results: [] });
    }

    const yandexUrl = `https://suggest-maps.yandex.ru/v1/suggest?apikey=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(String(text))}&type=${encodeURIComponent(String(type))}&results=${encodeURIComponent(String(results))}&lang=${encodeURIComponent(String(lang))}`;

    console.log('[geo/suggest] Fetching:', yandexUrl);

    const response = await axios.get(yandexUrl, { timeout: 10000 });
    
    if (response.status !== 200) {
      console.error('[geo/suggest] Yandex API error:', response.status, response.data);
      return res.status(response.status).json({ error: 'Yandex API error' });
    }

    const data = response.data;
    console.log('[geo/suggest] Yandex response:', data);
    
    // Normalize response
    const normalized = (data.results || []).map((item) => {
      const title = item.title?.text || item.title || '';
      const subtitle = item.subtitle?.text || item.subtitle || '';
      const displayText = [title, subtitle].filter(Boolean).join(', ') || item.text || '';
      const point = item?.tags?.point || item?.point;
      const coords = point && typeof point === 'object'
        ? { latitude: Number(point.lat), longitude: Number(point.lon) }
        : null;
      return { text: displayText, coords };
    }).filter((item) => item.text);

    console.log('[geo/suggest] Normalized results:', normalized.length);
    res.json({ results: normalized });
  } catch (error) {
    console.error('[geo/suggest] ERROR:', error.message, error.stack);
    logError('geo.suggest', error);
    res.status(500).json({ error: 'Failed to fetch suggestions', details: error.message });
  }
});

// Events Routes
router.get('/events', async (req, res) => {
  try {
    const { city, page = 1, limit = 20 } = req.query;
    
    const where = {
      date: {
        gte: new Date(),
      },
    };
    if (city) where.city = city;

    const events = await prisma.event.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, image: true },
        },
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: { date: 'asc' },
    });

    res.json(events);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

router.post('/events', authenticateToken, async (req, res) => {
  try {
    const payload = req.body || {};
    const parsed = eventCreateSchema.safeParse({
      ...payload,
      description: normalizeNullableString(payload.description),
      city: normalizeNullableString(payload.city),
      address: normalizeNullableString(payload.address),
      link: normalizeNullableString(payload.link),
      latitude: toNullableNumber(payload.latitude),
      longitude: toNullableNumber(payload.longitude),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Некорректные данные события', details: parsed.error.flatten() });
    }
    const { title, description, city, date, time, address, link, latitude, longitude } = parsed.data;
    const { dateValue, timeValue } = parseEventDateTime(date, time);

    if (Number.isNaN(dateValue.getTime()) || Number.isNaN(timeValue.getTime())) {
      return res.status(400).json({ error: 'Некорректные дата или время события' });
    }

    const event = await prisma.event.create({
      data: {
        title,
        description,
        city,
        date: dateValue,
        time: timeValue,
        address,
        link,
        latitude,
        longitude,
        created_by_id: req.user.userId,
      },
    });

    res.json(event);
  } catch (error) {
    logError('events.create', error, { userId: req.user?.userId });
    res.status(500).json({ error: 'Failed to create event' });
  }
});

router.delete('/events/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is the creator
    const event = await prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.created_by_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.event.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Push Notification Routes
router.post('/push/subscribe', authenticateToken, async (req, res) => {
  try {
    const { endpoint, p256dh_key, auth_key } = req.body;

    if (!endpoint || !p256dh_key || !auth_key) {
      // Silently ignore empty subscription data to prevent blocking
      console.log('Push subscribe: ignoring empty data');
      return res.json({ success: true, message: 'No subscription data provided' });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        user_id: req.user.userId,
        p256dh_key,
        auth_key,
      },
      create: {
        user_id: req.user.userId,
        endpoint,
        p256dh_key,
        auth_key,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

router.post('/push/send', authenticateToken, async (req, res) => {
  try {
    const { title, body, icon, tag } = req.body;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { user_id: req.user.userId },
    });

    const payload = JSON.stringify({
      title,
      body,
      icon: icon || '/favicons/android-chrome-192x192.png',
      tag: tag || 'motopara-notification',
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh_key,
              auth: sub.auth_key,
            },
          },
          payload
        )
      )
    );

    res.json({ results });
  } catch (error) {
    console.error('Push send error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// Upload Route
router.post('/upload', authenticateToken, async (req, res) => {
  try {
    const { image, fileName, oldUrl } = req.body || {};
    
    if (!image || !fileName) {
      return res.status(400).json({ error: 'Image and fileName required' });
    }

    const match = String(image).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    let mimeType = match?.[1] || 'image/jpeg';
    const base64Data = match?.[2] || String(image);
    
    // SECURITY: Validate MIME type
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(mimeType)) {
      return res.status(400).json({ error: `Invalid image format: ${mimeType}. Allowed: ${allowedMimes.join(', ')}` });
    }
    
    const sanitizedBase64 = base64Data.replace(/\s/g, '');
    if (!sanitizedBase64) {
      return res.status(400).json({ error: 'Empty file' });
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(sanitizedBase64)) {
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }

    const buffer = Buffer.from(sanitizedBase64, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Empty file' });
    }
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'PayloadTooLarge' });
    }

    // SECURITY: Validate magic bytes to prevent SVG/PHP upload
    const isValidImageFormat = validateImageMagicBytes(buffer, mimeType);
    if (!isValidImageFormat) {
      return res.status(400).json({ error: 'File signature does not match MIME type. Possible file type mismatch.' });
    }

    const uniqueFileName = `uploads/${req.user.userId}/${Date.now()}-${fileName}`;
    const imageUrl = await uploadToS3(buffer, uniqueFileName, mimeType);

    if (oldUrl && typeof oldUrl === 'string' && oldUrl !== imageUrl) {
      await deleteFromS3(oldUrl);
    }

    res.json({ url: imageUrl });
  } catch (error) {
    logError('upload', error, { userId: req.user?.userId });
    const message = String(error?.message || '');
    const code = String(error?.name || error?.Code || error?.code || '');
    const combined = `${code} ${message}`.toLowerCase();

    if (combined.includes('accessdenied') || combined.includes('forbidden')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    if (combined.includes('payloadtoolarge') || combined.includes('entity too large')) {
      return res.status(413).json({ error: 'PayloadTooLarge' });
    }
    if (combined.includes('signaturedoesnotmatch') || combined.includes('invalidaccesskeyid') || combined.includes('credentials')) {
      return res.status(500).json({ error: 'S3 credentials invalid' });
    }
    if (combined.includes('nosuchbucket')) {
      return res.status(500).json({ error: 'S3 bucket not found' });
    }
    if (combined.includes('timeout') || combined.includes('network') || combined.includes('enotfound') || combined.includes('getaddrinfo') || combined.includes('eai_again')) {
      return res.status(502).json({ error: 'S3 connection failed' });
    }

    return res.status(500).json({ error: 'Upload failed', details: message || 'Unknown error' });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export for Yandex Cloud Functions using serverless-http
module.exports.handler = serverless(app);

// For local testing
if (require.main === module) {
  const port = process.env.PORT || 3001;
  const server = http.createServer(app);
  initSocketIo(server);
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}
