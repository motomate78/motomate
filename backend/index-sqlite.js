const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

// SQLite Prisma client for local testing
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./dev.db'
    }
  }
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// WebSocket connections
const wsConnections = new Map();

wss.on('connection', (ws, req) => {
  const path = req.url.split('?')[0];
  console.log('WebSocket connection:', path);
  
  if (path.startsWith('/ws/')) {
    const type = path.replace('/ws/', '');
    wsConnections.set(type, ws);
    
    ws.on('close', () => {
      wsConnections.delete(type);
    });
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        // Broadcast to other connections of same type
        wsConnections.forEach((connection, key) => {
          if (key === type && connection !== ws && connection.readyState === WebSocket.OPEN) {
            connection.send(JSON.stringify(data));
          }
        });
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
  }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Mock Yandex OAuth for local testing
app.post('/api/auth/yandex', async (req, res) => {
  try {
    const { code } = req.body;
    
    // For local testing, accept any code and return mock user data
    let mockUser;
    if (code === 'alex') {
      mockUser = {
        id: 'alex123',
        email: 'alex@example.com',
        name: 'Alex Rider',
        avatar: 'https://storage.yandexcloud.net/motomate-storage/avatars/alex.jpg'
      };
    } else if (code === 'maria') {
      mockUser = {
        id: 'maria123',
        email: 'maria@example.com',
        name: 'Maria Moto',
        avatar: 'https://storage.yandexcloud.net/motomate-storage/avatars/maria.jpg'
      };
    } else {
      // Default mock user
      mockUser = {
        id: 'user123',
        email: 'user@example.com',
        name: 'Test User',
        avatar: 'https://storage.yandexcloud.net/motomate-storage/avatars/default.jpg'
      };
    }
    
    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { email: mockUser.email }
    });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: mockUser.email,
          name: mockUser.name,
          image: mockUser.avatar,
          city: 'Moscow',
          gender: 'male',
          age: 25
        }
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image
      }
    });
  } catch (error) {
    console.error('Yandex auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Email registration endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      name, 
      age, 
      city, 
      gender, 
      has_bike, 
      bike, 
      about, 
      music, 
      equip, 
      goal 
    } = req.body;
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password (in real app, use bcrypt)
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        age: parseInt(age),
        city,
        gender,
        has_bike: has_bike || false,
        bike: has_bike ? bike : null,
        about,
        music,
        equip,
        goal,
        image: `https://storage.yandexcloud.net/motomate-storage/avatars/${email.split('@')[0]}.jpg`
      }
    });
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
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
        has_bike: user.has_bike,
        bike: user.bike,
        about: user.about,
        music: user.music,
        equip: user.equip,
        goal: user.goal,
        image: user.image
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Email login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // In a real app, verify password hash
    // For now, we'll just check if password exists
    if (!password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
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
        has_bike: user.has_bike,
        bike: user.bike,
        about: user.about,
        music: user.music,
        equip: user.equip,
        goal: user.goal,
        image: user.image
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// User routes
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { name, age, city, bike, gender, has_bike, about, temp, music, equip, goal, image, latitude, longitude } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        name,
        age,
        city,
        bike,
        gender,
        has_bike,
        about,
        temp,
        music,
        equip,
        goal,
        image,
        latitude,
        longitude,
        location_updated_at: latitude && longitude ? new Date() : undefined
      }
    });
    
    res.json(user);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const { city, gender } = req.query;
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });
    
    let whereClause = {};
    if (city) whereClause.city = city;
    if (gender) whereClause.gender = gender;
    if (currentUser) whereClause.email = { not: currentUser.email };
    
    const users = await prisma.user.findMany({
      where: whereClause
    });
    
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Chat routes
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const chats = await prisma.chat.findMany({
      where: {
        OR: [
          { participant_1_id: req.user.userId },
          { participant_2_id: req.user.userId }
        ]
      },
      include: {
        participant1: {
          select: { id: true, name: true, image: true, location_updated_at: true }
        },
        participant2: {
          select: { id: true, name: true, image: true, location_updated_at: true }
        },
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1
        }
      }
    });
    
    res.json(chats);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

app.get('/api/chats/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify user is participant in chat
    const chat = await prisma.chat.findFirst({
      where: {
        id,
        OR: [
          { participant_1_id: req.user.userId },
          { participant_2_id: req.user.userId }
        ]
      }
    });
    
    if (!chat) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const messages = await prisma.message.findMany({
      where: { chat_id: id },
      orderBy: { created_at: 'asc' }
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

app.post('/api/chats/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, type, image } = req.body;
    
    // Verify user is participant in chat
    const chat = await prisma.chat.findFirst({
      where: {
        id,
        OR: [
          { participant_1_id: req.user.userId },
          { participant_2_id: req.user.userId }
        ]
      }
    });
    
    if (!chat) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Create message
    const message = await prisma.message.create({
      data: {
        chat_id: id,
        sender_id: req.user.userId,
        text,
        type: type || 'text',
        image
      }
    });
    
    // Update chat last message
    await prisma.chat.update({
      where: { id },
      data: {
        last_message: text || 'Image',
        last_message_time: new Date()
      }
    });
    
    // Notify via WebSocket
    const ws = wsConnections.get('messages');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'new_message',
        chat_id: id,
        message
      }));
    }
    
    res.json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Likes routes
app.post('/api/likes', authenticateToken, async (req, res) => {
  try {
    const { to_user_id } = req.body;
    const from_user_id = req.user.userId;
    
    // Check if like already exists
    const existingLike = await prisma.like.findUnique({
      where: {
        from_user_id_to_user_id: {
          from_user_id,
          to_user_id
        }
      }
    });
    
    let liked = false;
    
    if (existingLike) {
      // Remove like
      await prisma.like.delete({
        where: { id: existingLike.id }
      });
    } else {
      // Add like
      await prisma.like.create({
        data: {
          from_user_id,
          to_user_id
        }
      });
      liked = true;
      
      // Check for mutual like (match)
      const mutualLike = await prisma.like.findUnique({
        where: {
          from_user_id_to_user_id: {
            from_user_id: to_user_id,
            to_user_id: from_user_id
          }
        }
      });
      
      if (mutualLike) {
        // Create chat for match
        await prisma.chat.create({
          data: {
            participant_1_id: from_user_id,
            participant_2_id: to_user_id,
            last_message: 'It\'s a match! Start chatting!',
            last_message_time: new Date()
          }
        });
        
        // Notify via WebSocket
        const ws = wsConnections.get('matches');
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'new_match',
            from_user_id,
            to_user_id
          }));
        }
      }
      
      // Notify via WebSocket
      const ws = wsConnections.get('likes');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'new_like',
          from_user_id,
          to_user_id
        }));
      }
    }
    
    res.json({ liked });
  } catch (error) {
    console.error('Toggle like error:', error);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

app.get('/api/matches', authenticateToken, async (req, res) => {
  try {
    // Get users that have mutual likes with current user
    const likes = await prisma.like.findMany({
      where: { from_user_id: req.user.userId }
    });
    
    const matches = [];
    
    for (const like of likes) {
      const mutualLike = await prisma.like.findUnique({
        where: {
          from_user_id_to_user_id: {
            from_user_id: like.to_user_id,
            to_user_id: req.user.userId
          }
        }
      });
      
      if (mutualLike) {
        const user = await prisma.user.findUnique({
          where: { id: like.to_user_id },
          select: { id: true, name: true, image: true, city: true, age: true }
        });
        
        if (user) {
          matches.push(user);
        }
      }
    }
    
    res.json(matches);
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ error: 'Failed to get matches' });
  }
});

// Events routes
app.get('/api/events', authenticateToken, async (req, res) => {
  try {
    const { city } = req.query;
    let whereClause = {};
    if (city) whereClause.city = city;
    
    const events = await prisma.event.findMany({
      where: whereClause,
      orderBy: { date: 'asc' },
      include: {
        createdBy: {
          select: { id: true, name: true, image: true }
        }
      }
    });
    
    res.json(events);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

app.post('/api/events', authenticateToken, async (req, res) => {
  try {
    const { title, description, city, date, time, address, link } = req.body;
    
    const event = await prisma.event.create({
      data: {
        title,
        description,
        city,
        date: new Date(date),
        time: new Date(time),
        address,
        link,
        created_by_id: req.user.userId
      },
      include: {
        createdBy: {
          select: { id: true, name: true, image: true }
        }
      }
    });
    
    res.json(event);
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'sqlite' });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('WebSocket server ready');
  console.log('Using SQLite for local testing');
});

// Export for testing
module.exports = { app, server, prisma };
