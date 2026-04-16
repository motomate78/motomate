const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

// Use SQLite for local testing
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./dev.db'
    }
  }
});

async function setupDatabase() {
  try {
    console.log('Setting up SQLite database...');
    
    // Reset database
    await prisma.$executeRaw`DELETE FROM likes`;
    await prisma.$executeRaw`DELETE FROM messages`;
    await prisma.$executeRaw`DELETE FROM chats`;
    await prisma.$executeRaw`DELETE FROM events`;
    await prisma.$executeRaw`DELETE FROM users`;
    
    // Create test users
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const testUser1 = await prisma.user.create({
      data: {
        email: 'alex@example.com',
        name: 'Alex Rider',
        age: 28,
        city: 'Moscow',
        gender: 'male',
        has_bike: true,
        about: 'Love speed and motorcycles',
        image: 'https://storage.yandexcloud.net/motomate-storage/avatars/alex.jpg',
        latitude: 55.7558,
        longitude: 37.6173
      }
    });
    
    const testUser2 = await prisma.user.create({
      data: {
        email: 'maria@example.com',
        name: 'Maria Moto',
        age: 25,
        city: 'Moscow',
        gender: 'female',
        has_bike: false,
        about: 'Looking for riding partner',
        image: 'https://storage.yandexcloud.net/motomate-storage/avatars/maria.jpg',
        latitude: 55.7558,
        longitude: 37.6173
      }
    });
    
    const testUser3 = await prisma.user.create({
      data: {
        email: 'biker@example.com',
        name: 'Biker Pro',
        age: 30,
        city: 'Moscow',
        gender: 'male',
        has_bike: true,
        about: 'Professional rider',
        image: 'https://storage.yandexcloud.net/motomate-storage/avatars/biker.jpg',
        latitude: 55.7558,
        longitude: 37.6173
      }
    });
    
    // Create test event
    const testEvent = await prisma.event.create({
      data: {
        title: 'Moscow Bike Meetup',
        description: 'Monthly motorcycle meetup in Moscow',
        city: 'Moscow',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next week
        time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        address: 'Red Square, Moscow',
        link: 'https://example.com/event',
        created_by_id: testUser1.id
      }
    });
    
    // Create test like
    await prisma.like.create({
      data: {
        from_user_id: testUser1.id,
        to_user_id: testUser2.id
      }
    });
    
    // Create test chat
    const testChat = await prisma.chat.create({
      data: {
        participant_1_id: testUser1.id,
        participant_2_id: testUser2.id,
        last_message: 'Hello! Want to go for a ride?',
        last_message_time: new Date()
      }
    });
    
    // Create test messages
    await prisma.message.create({
      data: {
        chat_id: testChat.id,
        sender_id: testUser1.id,
        text: 'Hello! Want to go for a ride?',
        type: 'text'
      }
    });
    
    await prisma.message.create({
      data: {
        chat_id: testChat.id,
        sender_id: testUser2.id,
        text: 'Sure! I would love to!',
        type: 'text'
      }
    });
    
    console.log('SQLite database setup complete!');
    console.log('Test users created:');
    console.log('- alex@example.com (Alex Rider)');
    console.log('- maria@example.com (Maria Moto)');
    console.log('- biker@example.com (Biker Pro)');
    console.log('Test event created: Moscow Bike Meetup');
    console.log('Test chat and messages created');
    
  } catch (error) {
    console.error('Error setting up database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupDatabase();
