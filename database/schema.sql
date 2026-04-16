-- MotoMate Database Schema for Yandex Cloud PostgreSQL
-- Generated from Prisma schema

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    age INTEGER,
    city TEXT,
    bike TEXT,
    gender TEXT,
    has_bike BOOLEAN DEFAULT false,
    about TEXT,
    temp TEXT,
    music TEXT,
    equip TEXT,
    goal TEXT,
    image TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    participant_1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message TEXT,
    last_message_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT,
    image TEXT,
    type TEXT DEFAULT 'text',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Likes table
CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_user_id, to_user_id)
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    title TEXT NOT NULL,
    description TEXT,
    city TEXT,
    date TIMESTAMP NOT NULL,
    time TIMESTAMP NOT NULL,
    address TEXT,
    link TEXT,
    created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_city ON users(city);
CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_chats_participants ON chats(participant_1_id, participant_2_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_likes_from_user ON likes(from_user_id);
CREATE INDEX IF NOT EXISTS idx_likes_to_user ON likes(to_user_id);
CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate cuid-like IDs
CREATE OR REPLACE FUNCTION cuid()
RETURNS TEXT AS $$
DECLARE
    alphabet TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..25 LOOP
        result := result || substr(alphabet, floor(random() * length(alphabet)) + 1, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Sample data for testing (optional)
-- INSERT INTO users (id, email, name, age, city, gender, has_bike, about, image)
-- VALUES 
--     ('test1', 'test1@example.com', 'Alex Rider', 28, 'Moscow', 'male', true, 'Love speed and motorcycles', 'https://example.com/avatar1.jpg'),
--     ('test2', 'test2@example.com', 'Maria Moto', 25, 'Moscow', 'female', false, 'Looking for riding partner', 'https://example.com/avatar2.jpg');
