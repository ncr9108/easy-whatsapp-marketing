import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { sql } from "../shared/db.ts";
import { decryptToken } from "../shared/crypto.ts";

interface WhatsAppParam {
  type: string;
  text: string;
}

// Map database placeholders to actual context values
function resolveVariables(variableMap: any, context: any): WhatsAppParam[] {
  let mapped = variableMap;
  if (typeof mapped === 'string') {
    try {
      mapped = JSON.parse(mapped);
    } catch (e) {
      console.error("[Send-WhatsApp] Failed to parse variableMap JSON string:", e);
    }
  }
  if (!Array.isArray(mapped)) return [];

  return mapped.map((variableName) => {
    let text = '';
    switch (variableName) {
      case 'customer_name':
        text = context.customerName || context.customer_name || 'Customer';
        break;
      case 'store_name':
        text = context.storeName || context.store_name || '';
        break;
      case 'checkout_url':
        text = context.checkoutUrl || context.checkout_url || '';
        break;
      case 'discount_code':
        text = context.discountCode || context.discount_code || '';
        break;
      case 'order_number':
        text = context.orderNumber || context.order_number || '';
        break;
      case 'order_total':
        const total = context.orderTotal || context.total_amount || 0;
        text = `$${parseFloat(total).toFixed(2)}`;
        break;
      case 'tracking_url':
        text = context.trackingUrl || context.tracking_url || '';
        break;
      default:
        text = '';
    }
    
    // Safety check to ensure Meta never rejects empty strings
    if (!text || text.trim() === '') {
      if (variableName === 'checkout_url' || variableName === 'tracking_url' || variableName.endsWith('_url')) {
        text = context.store_name ? `https://${context.store_name}.myshopify.com` : 'https://www.shopify.com';
      } else if (variableName === 'discount_code') {
        text = 'WELCOME';
      } else if (variableName === 'order_number') {
        text = '#1001';
      } else if (variableName === 'store_name') {
        text = context.store_name || 'Our Store';
      } else {
        text = 'N/A';
      }
    }
    
    return { type: 'text', text: String(text) };
  });
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json();
    const record = payload.record; // Supabase Webhook passes row in "record"

    if (!record || !record.id || !record.store_id) {
      return new Response('Invalid webhook payload record', { status: 400 });
    }

    const { id: logId, store_id: storeId, recipient_phone, message_type, abandoned_checkout_id, order_id } = record;
    console.log(`[Send-WhatsApp Worker] Triggered for LogID: ${logId} | StoreID: ${storeId}`);

    // 1. Fetch Meta credentials from database
    const waResult = await sql`
      SELECT phone_number_id, access_token_encrypted, connected 
      FROM whatsapp_accounts 
      WHERE store_id = ${storeId} AND connected = true
    `;

    if (waResult.length === 0) {
      await sql`UPDATE message_logs SET status = 'FAILED', error_message = 'WhatsApp credentials not connected' WHERE id = ${logId}`;
      return new Response('WhatsApp setup not connected', { status: 200 });
    }

    const { phone_number_id, access_token_encrypted } = waResult[0];

    // 2. Fetch template config
    const isCartRecovery = message_type.startsWith('ABANDONED_CART');
    const templateType = isCartRecovery ? 'ABANDONED_CART' : 'ORDER_CONFIRMATION';

    const templateResult = await sql`
      SELECT body_text, variables, is_enabled, meta_template_name 
      FROM message_templates 
      WHERE store_id = ${storeId} AND template_type = ${templateType}
    `;

    if (templateResult.length === 0 || !templateResult[0].is_enabled) {
      await sql`UPDATE message_logs SET status = 'FAILED', error_message = 'Template is disabled or missing' WHERE id = ${logId}`;
      return new Response('Template not active', { status: 200 });
    }

    const template = templateResult[0];

    // 3. Fetch context data (Checkout or Order details)
    let contextData: any = {};
    if (isCartRecovery && abandoned_checkout_id) {
      const checkouts = await sql`SELECT * FROM abandoned_checkouts WHERE id = ${abandoned_checkout_id}`;
      if (checkouts.length > 0) {
        contextData = checkouts[0];
      }
    } else if (order_id) {
      const orders = await sql`SELECT * FROM orders WHERE id = ${order_id}`;
      if (orders.length > 0) {
        contextData = orders[0];
      }
    }

    // Include store name as helper
    const storeRes = await sql`SELECT shop_domain FROM stores WHERE id = ${storeId}`;
    if (storeRes.length > 0) {
      contextData.store_name = storeRes[0].shop_domain.replace('.myshopify.com', '');
    }

    // 4. Decrypt token & format parameters
    const accessToken = await decryptToken(access_token_encrypted);
    const resolvedParams = resolveVariables(template.variables, contextData);

    const cleanPhone = recipient_phone.replace(/[+\s]/g, '');

    // Setup Meta payload
    // Determine Meta Template Name (e.g. 'abandoned_cart_6h' or 'order_confirmation')
    let metaTemplateName = template.meta_template_name;
    if (!metaTemplateName) {
      metaTemplateName = 'order_confirmation';
      if (isCartRecovery) {
        const hoursMatch = message_type.match(/(\d+)H/);
        const hours = hoursMatch ? hoursMatch[1] : '6';
        metaTemplateName = `abandoned_cart_${hours}h`;
      }
    }

    const payloadMeta = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'template',
      template: {
        name: metaTemplateName,
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: resolvedParams,
          },
        ],
      },
    };

    console.log(`[Meta Client] Delivering template: ${metaTemplateName} to ${cleanPhone}`);

    const metaResponse = await fetch(`https://graph.facebook.com/v19.0/${phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloadMeta),
    });

    const metaResult = await metaResponse.json();

    if (metaResponse.ok && metaResult.messages?.[0]?.id) {
      const messageId = metaResult.messages[0].id;
      console.log(`[Worker] Deliver successful. Meta message ID: ${messageId}`);

      // Update message log
      await sql`
        UPDATE message_logs 
        SET status = 'SENT', whatsapp_message_id = ${messageId}, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ${logId}
      `;

      // Increment billing count
      await sql`
        UPDATE subscriptions 
        SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE store_id = ${storeId} AND status = 'ACTIVE'
      `;
    } else {
      const errorMsg = metaResult.error?.message || 'Meta API returned request error';
      console.error(`[Worker] Meta API failed: ${errorMsg}`);
      
      await sql`
        UPDATE message_logs 
        SET status = 'FAILED', error_message = ${errorMsg}, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ${logId}
      `;
    }

    return new Response('Processed message send', { status: 200 });
  } catch (error) {
    console.error('Fatal crash in send-whatsapp edge function:', error);
    return new Response('Internal worker crash', { status: 500 });
  }
});
