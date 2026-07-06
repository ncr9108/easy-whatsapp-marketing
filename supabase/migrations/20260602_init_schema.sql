-- EasyWhatsAppMarketing Supabase Database Schema

-- Enable pg_net extension for Database Webhooks
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. STORES TABLE
CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    shop_domain VARCHAR(255) UNIQUE NOT NULL,
    access_token VARCHAR(255) NOT NULL,
    plan VARCHAR(50) DEFAULT 'STARTER' NOT NULL, -- 'STARTER', 'GROWTH', 'PRO'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. WHATSAPP ACCOUNTS TABLE
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE UNIQUE,
    business_account_id VARCHAR(255) NOT NULL,
    phone_number_id VARCHAR(255) NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    connected BOOLEAN DEFAULT FALSE NOT NULL,
    phone_number VARCHAR(50),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 3. SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    shopify_subscription_id VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'ACTIVE', 'DECLINED', 'CANCELLED'
    plan VARCHAR(50) NOT NULL, -- 'STARTER', 'GROWTH', 'PRO'
    price DECIMAL(10, 2) NOT NULL,
    message_limit INTEGER NOT NULL, -- 500, 5000, -1 (unlimited)
    message_count INTEGER DEFAULT 0 NOT NULL,
    billing_on TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. MESSAGE TEMPLATES TABLE
CREATE TABLE IF NOT EXISTS message_templates (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    template_type VARCHAR(100) NOT NULL, -- 'ABANDONED_CART', 'ORDER_CONFIRMATION'
    body_text TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb NOT NULL, -- Array of supported variables
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_store_template UNIQUE(store_id, template_type)
);

-- 5. ABANDONED CHECKOUTS TABLE
CREATE TABLE IF NOT EXISTS abandoned_checkouts (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    checkout_id VARCHAR(255) UNIQUE NOT NULL,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    customer_email VARCHAR(255),
    checkout_url TEXT NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    recovered BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 6. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    order_id VARCHAR(255) UNIQUE NOT NULL,
    order_number VARCHAR(100) NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    checkout_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 7. AUTOMATION RULES TABLE
CREATE TABLE IF NOT EXISTS automation_rules (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    delay_hours INTEGER NOT NULL,
    is_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_store_delay UNIQUE(store_id, delay_hours)
);

-- 8. MESSAGE LOGS TABLE
CREATE TABLE IF NOT EXISTS message_logs (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    abandoned_checkout_id INTEGER REFERENCES abandoned_checkouts(id) ON DELETE SET NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    recipient_phone VARCHAR(50) NOT NULL,
    message_type VARCHAR(100) NOT NULL,
    whatsapp_message_id VARCHAR(255) UNIQUE,
    status VARCHAR(50) DEFAULT 'PENDING' NOT NULL, -- 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 9. BILLING EVENTS TABLE
CREATE TABLE IF NOT EXISTS billing_events (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create standard indexes
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_recovery ON abandoned_checkouts(store_id, recovered);
CREATE INDEX IF NOT EXISTS idx_message_logs_checkout_type ON message_logs(abandoned_checkout_id, message_type);
CREATE INDEX IF NOT EXISTS idx_orders_checkout_id ON orders(checkout_id);
