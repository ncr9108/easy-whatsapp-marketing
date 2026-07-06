-- Add support for Shopify expiring offline tokens
ALTER TABLE stores 
ADD COLUMN IF NOT EXISTS refresh_token VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
