-- Add WhatsApp Meta template registration fields to message_templates
ALTER TABLE message_templates 
ADD COLUMN IF NOT EXISTS meta_template_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS meta_status VARCHAR(50) DEFAULT 'NOT_REGISTERED',
ADD COLUMN IF NOT EXISTS meta_error TEXT DEFAULT NULL;
