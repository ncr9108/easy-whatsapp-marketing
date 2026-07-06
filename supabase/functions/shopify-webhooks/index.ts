import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { sql } from "../shared/db.ts";

const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") || "";

// Helpers to parse webhook parameters
function extractPhone(payload: any): string | null {
  const phone = payload.phone || 
                payload.customer?.phone || 
                payload.shipping_address?.phone || 
                payload.billing_address?.phone;
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d]/g, '');
  return cleaned.length >= 8 ? cleaned : null;
}

function extractName(payload: any): string {
  const firstName = payload.customer?.first_name || '';
  const lastName = payload.customer?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) return fullName;
  
  return payload.billing_address?.name || 
         payload.shipping_address?.name || 
         payload.customer?.email || 
         'Customer';
}

// HMAC signature verification using standard Deno Web Crypto
async function verifyShopifyHmac(bodyText: string, hmacHeader: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(bodyText)
    );
    
    // Shopify sends signature in base64 format
    const computedHmac = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    return computedHmac === hmacHeader;
  } catch (error) {
    console.error('HMAC verification processing error:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const topic = req.headers.get('x-shopify-topic');
  const shop = req.headers.get('x-shopify-shop-domain');

  if (!hmacHeader || !topic || !shop) {
    return new Response('Missing headers', { status: 400 });
  }

  const rawBody = await req.text();

  // Verify HMAC signature
  const verified = await verifyShopifyHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET);
  if (!verified) {
    console.warn(`Shopify webhook signature check failed for topic: ${topic}`);
    return new Response('Unauthorized Webhook Signature', { status: 401 });
  }

  const body = JSON.parse(rawBody);
  console.log(`Processing Shopify Webhook: [${topic}] for shop: ${shop}`);

  // Fetch store details
  const storeResult = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
  if (storeResult.length === 0 && topic !== 'app/uninstalled') {
    console.warn(`Webhook ignored: Store not found for shop ${shop}`);
    return new Response('Store not found', { status: 200 }); // Return 200 so Shopify stops retrying
  }
  const store = storeResult[0];

  try {
    switch (topic) {
      case 'app/uninstalled': {
        console.log(`Cleansing access credentials for uninstalled shop: ${shop}`);
        await sql`
          UPDATE whatsapp_accounts 
          SET connected = false, access_token_encrypted = '' 
          WHERE store_id = (SELECT id FROM stores WHERE shop_domain = ${shop})
        `;
        await sql`UPDATE stores SET access_token = '' WHERE shop_domain = ${shop}`;
        break;
      }

      case 'checkouts/create':
      case 'checkouts/update': {
        const checkoutId = String(body.id || body.token);
        const name = extractName(body);
        const phone = extractPhone(body);
        const email = body.email || body.customer?.email || null;
        const checkoutUrl = body.abandoned_checkout_url || '';
        const totalAmount = parseFloat(body.total_line_items_price || body.total_price || 0);
        const createdAt = body.created_at || new Date().toISOString();

        console.log(`Logging abandoned checkout ID: ${checkoutId}`);

        await sql`
          INSERT INTO abandoned_checkouts 
            (store_id, checkout_id, customer_name, customer_phone, customer_email, checkout_url, total_amount, recovered, created_at, updated_at)
          VALUES (${store.id}, ${checkoutId}, ${name}, ${phone}, ${email}, ${checkoutUrl}, ${totalAmount}, false, ${createdAt}, CURRENT_TIMESTAMP)
          ON CONFLICT (checkout_id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            customer_phone = EXCLUDED.customer_phone,
            customer_email = EXCLUDED.customer_email,
            checkout_url = EXCLUDED.checkout_url,
            total_amount = EXCLUDED.total_amount,
            updated_at = CURRENT_TIMESTAMP
        `;
        break;
      }

      case 'orders/create': {
        const orderId = String(body.id);
        const orderNumber = String(body.order_number || body.name);
        const totalAmount = parseFloat(body.total_price || 0);
        const name = extractName(body);
        const phone = extractPhone(body);
        const checkoutToken = String(body.checkout_token || '');
        const createdAt = body.created_at || new Date().toISOString();

        console.log(`Processing Order ${orderNumber}. Marking checkout recovered.`);

        // Insert order record
        const orderInsert = await sql`
          INSERT INTO orders 
            (store_id, order_id, order_number, total_amount, customer_name, customer_phone, checkout_id, created_at)
          VALUES (${store.id}, ${orderId}, ${orderNumber}, ${totalAmount}, ${name}, ${phone}, ${checkoutToken}, ${createdAt})
          ON CONFLICT (order_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `;
        
        const orderRecordId = orderInsert[0].id;

        // Mark checkout recovered
        if (checkoutToken) {
          await sql`
            UPDATE abandoned_checkouts 
            SET recovered = true, updated_at = CURRENT_TIMESTAMP 
            WHERE checkout_id = ${checkoutToken}
          `;
        }

        // Check if Order Confirmation Template message is enabled
        const templateResult = await sql`
          SELECT body_text, variables, is_enabled 
          FROM message_templates 
          WHERE store_id = ${store.id} AND template_type = 'ORDER_CONFIRMATION'
        `;
        const template = templateResult[0];

        if (template && template.is_enabled && phone) {
          // Verify WhatsApp connection details
          const waResult = await sql`
            SELECT id, connected FROM whatsapp_accounts 
            WHERE store_id = ${store.id} AND connected = true
          `;
          
          if (waResult.length > 0) {
            console.log(`Logging PENDING WhatsApp Order Confirmation for ${orderNumber}`);
            
            // Insert log to database. Database Webhook will fire on INSERT and call send-whatsapp Edge Function!
            await sql`
              INSERT INTO message_logs 
                (store_id, order_id, recipient_phone, message_type, status)
              VALUES (${store.id}, ${orderRecordId}, ${phone}, 'ORDER_CONFIRMATION', 'PENDING')
            `;
          }
        }
        break;
      }
    }

    return new Response('Webhook processed successfully', { status: 200 });
  } catch (error) {
    console.error('Webhook execution failure:', error);
    return new Response('Internal webhook error', { status: 500 });
  }
});
