const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection for local testing
const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'motomate'
});

async function setupDatabase() {
  try {
    // Connect to PostgreSQL server (without specifying database)
    const adminClient = new Client({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres'
    });
    
    await adminClient.connect();
    
    // Create database if it doesn't exist
    try {
      await adminClient.query('CREATE DATABASE motomate');
      console.log('Database "motomate" created successfully');
    } catch (error) {
      if (error.code === '42P04') {
        console.log('Database "motomate" already exists');
      } else {
        throw error;
      }
    }
    
    await adminClient.end();
    
    // Connect to the motomate database
    await client.connect();
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schema);
    console.log('Schema executed successfully');
    
    // Insert sample data for testing
    await client.query(`
      INSERT INTO users (id, email, name, age, city, gender, has_bike, about, image) 
      VALUES 
        ('test1', 'test1@example.com', 'Alex Rider', 28, 'Moscow', 'male', true, 'Love speed and motorcycles', 'https://storage.yandexcloud.net/motomate-storage/avatars/test1.jpg'),
        ('test2', 'test2@example.com', 'Maria Moto', 25, 'Moscow', 'female', false, 'Looking for riding partner', 'https://storage.yandexcloud.net/motomate-storage/avatars/test2.jpg')
      ON CONFLICT (email) DO NOTHING
    `);
    
    console.log('Sample data inserted successfully');
    
  } catch (error) {
    console.error('Error setting up database:', error);
  } finally {
    await client.end();
  }
}

setupDatabase();
