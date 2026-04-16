-- MotoMate Database Schema for Yandex Cloud Managed PostgreSQL
-- This file contains the complete schema for deployment to Yandex Cloud

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    age INTEGER CHECK (age >= 18 AND age <= 100),
    city TEXT,
    bike TEXT,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    has_bike BOOLEAN DEFAULT false,
    about TEXT,
    temp TEXT,
    music TEXT,
    equip TEXT,
    goal TEXT,
    image TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    participant_1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message TEXT,
    last_message_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_participants CHECK (
        participant_1_id < participant_2_id
    )
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT,
    image TEXT,
    type TEXT DEFAULT 'text' CHECK (type IN ('text', 'image', 'system')),
    is_read BOOLEAN DEFAULT false,
    is_edited BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Likes table
CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_like UNIQUE(from_user_id, to_user_id),
    CONSTRAINT no_self_like CHECK (from_user_id != to_user_id)
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY DEFAULT (cuid()),
    title TEXT NOT NULL,
    description TEXT,
    city TEXT,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    address TEXT,
    link TEXT,
    created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT future_event CHECK (date >= CURRENT_DATE)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_city ON users(city);
CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_location_updated ON users(location_updated_at) WHERE location_updated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_name_trgm ON users USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_about_trgm ON users USING gin(about gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_chats_participants ON chats(participant_1_id, participant_2_id);
CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_time DESC) WHERE last_message_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(chat_id, is_read) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_likes_from_user ON likes(from_user_id);
CREATE INDEX IF NOT EXISTS idx_likes_to_user ON likes(to_user_id);
CREATE INDEX IF NOT EXISTS idx_likes_created_at ON likes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date ASC);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by_id);

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

-- Function to create chat automatically when mutual like occurs
CREATE OR REPLACE FUNCTION create_chat_on_mutual_like()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if mutual like exists
    IF EXISTS (
        SELECT 1 FROM likes 
        WHERE from_user_id = NEW.to_user_id 
        AND to_user_id = NEW.from_user_id
    ) THEN
        -- Create chat for the match
        INSERT INTO chats (participant_1_id, participant_2_id, last_message, last_message_time)
        VALUES (
            LEAST(NEW.from_user_id, NEW.to_user_id),
            GREATEST(NEW.from_user_id, NEW.to_user_id),
            'It''s a match! Start chatting!',
            CURRENT_TIMESTAMP
        )
        ON CONFLICT DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create chat on mutual like
CREATE TRIGGER create_chat_trigger
    AFTER INSERT ON likes
    FOR EACH ROW
    EXECUTE FUNCTION create_chat_on_mutual_like();

-- Function to update chat last message
CREATE OR REPLACE FUNCTION update_chat_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats 
    SET 
        last_message = COALESCE(NEW.text, 'Image'),
        last_message_time = NEW.created_at,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.chat_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update chat last message
CREATE TRIGGER update_chat_last_message_trigger
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_last_message();

-- Views for common queries
CREATE OR REPLACE VIEW user_matches AS
SELECT 
    u1.id as user_id,
    u2.id as match_id,
    u2.name as match_name,
    u2.image as match_image,
    u2.city as match_city,
    u2.age as match_age,
    l1.created_at as like_created_at
FROM users u1
JOIN likes l1 ON u1.id = l1.from_user_id
JOIN users u2 ON l1.to_user_id = u2.id
WHERE EXISTS (
    SELECT 1 FROM likes l2 
    WHERE l2.from_user_id = l1.to_user_id 
    AND l2.to_user_id = l1.from_user_id
);

CREATE OR REPLACE VIEW chat_participants AS
SELECT 
    c.id as chat_id,
    c.last_message,
    c.last_message_time,
    p1.id as participant_1_id,
    p1.name as participant_1_name,
    p1.image as participant_1_image,
    p2.id as participant_2_id,
    p2.name as participant_2_name,
    p2.image as participant_2_image
FROM chats c
JOIN users p1 ON c.participant_1_id = p1.id
JOIN users p2 ON c.participant_2_id = p2.id;

-- Sample data for initial testing (optional - remove for production)
INSERT INTO users (id, email, name, age, city, gender, has_bike, about, image) 
VALUES 
    ('admin', 'admin@motomate.ru', 'Admin User', 30, 'Moscow', 'other', true, 'System administrator', 'https://storage.yandexcloud.net/motomate-storage/avatars/admin.jpg')
ON CONFLICT (email) DO NOTHING;

-- Grant permissions (adjust as needed for your security model)
-- GRANT USAGE ON SCHEMA public TO motomate_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motomate_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO motomate_user;

-- Set up Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Users can only see/update their own profile
CREATE POLICY users_own_profile ON users
    FOR ALL USING (id = current_setting('app.current_user_id', true)::text);

-- Users can only see chats they participate in
CREATE POLICY chats_participants ON chats
    FOR ALL USING (
        participant_1_id = current_setting('app.current_user_id', true)::text OR
        participant_2_id = current_setting('app.current_user_id', true)::text
    );

-- Users can only see messages in their chats
CREATE POLICY messages_chat_participants ON messages
    FOR ALL USING (
        chat_id IN (
            SELECT id FROM chats WHERE 
            participant_1_id = current_setting('app.current_user_id', true)::text OR
            participant_2_id = current_setting('app.current_user_id', true)::text
        )
    );

-- Users can see likes they sent or received
CREATE POLICY likes_visible ON likes
    FOR SELECT USING (
        from_user_id = current_setting('app.current_user_id', true)::text OR
        to_user_id = current_setting('app.current_user_id', true)::text
    );

-- Users can create likes they send
CREATE POLICY likes_create ON likes
    FOR INSERT WITH CHECK (from_user_id = current_setting('app.current_user_id', true)::text);

-- Users can delete likes they sent
CREATE POLICY likes_delete ON likes
    FOR DELETE USING (from_user_id = current_setting('app.current_user_id', true)::text);

-- Events are visible to everyone, but only creators can update/delete
CREATE POLICY events_select ON events FOR SELECT USING (true);
CREATE POLICY events_update ON events FOR UPDATE USING (created_by_id = current_setting('app.current_user_id', true)::text);
CREATE POLICY events_delete ON events FOR DELETE USING (created_by_id = current_setting('app.current_user_id', true)::text);

COMMIT;
