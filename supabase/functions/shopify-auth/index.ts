import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { sql } from "../shared/db.ts";

const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY") || "";
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") || "";
const SHOPIFY_SCOPES = Deno.env.get("SHOPIFY_SCOPES") || "write_orders,write_draft_orders,write_checkouts,read_checkouts,read_orders";
const SHOPIFY_APP_HOST = Deno.env.get("SHOPIFY_APP_HOST") || "";

// Standard CORS headers for Edge Functions
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight options
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // ----------------------------------------------------
  // 1. OAUTH START REDIRECT
  // ----------------------------------------------------
  if (path.endsWith("/shopify-auth") || path.endsWith("/shopify-auth/")) {
    const shop = url.searchParams.get("shop");
    if (!shop) {
      return new Response("Missing shop parameter", { status: 400, headers: corsHeaders });
    }

    const redirectUri = `https://${SHOPIFY_APP_HOST}/functions/v1/shopify-auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=nonce`;
    
    console.log(`Redirecting shop ${shop} to OAuth page`);
    return Response.redirect(installUrl, 307);
  }

  // ----------------------------------------------------
  // 2. OAUTH CALLBACK RESPONSE
  // ----------------------------------------------------
  if (path.includes("/shopify-auth/callback")) {
    const shop = url.searchParams.get("shop");
    const code = url.searchParams.get("code");
    const hmac = url.searchParams.get("hmac");

    if (!shop || !code || !hmac) {
      return new Response("Invalid Callback Parameters", { status: 400, headers: corsHeaders });
    }

    try {
      console.log(`Exchanging code for permanent access token for shop ${shop}`);
      
      const bodyParams = new URLSearchParams();
      bodyParams.append("client_id", SHOPIFY_API_KEY);
      bodyParams.append("client_secret", SHOPIFY_API_SECRET);
      bodyParams.append("code", code);
      bodyParams.append("expiring", "1");

      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyParams.toString(),
      });

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || null;
      const expiresSeconds = tokenData.expires_in || null;
      const expiresAt = expiresSeconds ? new Date(Date.now() + expiresSeconds * 1000) : null;
      
      if (!accessToken) {
        console.error("Failed to fetch access token from Shopify:", tokenData);
        return new Response("Access token acquisition failed", { status: 422, headers: corsHeaders });
      }

      // 1. Insert or update the shop domain details
      await sql`
        INSERT INTO stores (shop_domain, access_token, refresh_token, expires_at, plan)
        VALUES (${shop}, ${accessToken}, ${refreshToken}, ${expiresAt}, 'STARTER')
        ON CONFLICT (shop_domain) 
        DO UPDATE SET 
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at = EXCLUDED.expires_at,
          updated_at = CURRENT_TIMESTAMP
      `;

      // Resolve store database ID
      const storeResult = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
      const storeId = storeResult[0].id;

      // 2. Initialize default templates
      await sql`
        INSERT INTO message_templates (store_id, template_type, body_text, variables, is_enabled)
        VALUES 
          (${storeId}, 'ABANDONED_CART', 'Hi {{customer_name}}, we noticed you left items in your cart. Complete your order here: {{checkout_url}}. Happy Shopping!', '["customer_name", "checkout_url"]'::jsonb, true),
          (${storeId}, 'ORDER_CONFIRMATION', 'Hi {{customer_name}}, thanks for your order {{order_number}}! Total: {{order_total}}. Track: {{tracking_url}}. Thank you!', '["customer_name", "order_number", "order_total", "tracking_url"]'::jsonb, true)
        ON CONFLICT (store_id, template_type) DO NOTHING
      `;

      // 3. Initialize default automation rules
      await sql`
        INSERT INTO automation_rules (store_id, delay_hours, is_enabled)
        VALUES 
          (${storeId}, 6, false),
          (${storeId}, 12, false),
          (${storeId}, 24, false),
          (${storeId}, 48, false)
        ON CONFLICT (store_id, delay_hours) DO NOTHING
      `;

      // 4. Initialize dummy installation subscription
      await sql`
        INSERT INTO subscriptions (store_id, shopify_subscription_id, status, plan, price, message_limit, message_count)
        VALUES (${storeId}, 'dummy_installation_charge', 'ACTIVE', 'STARTER', 0.00, 500, 0)
        ON CONFLICT (shopify_subscription_id) DO NOTHING
      `;

      // Register webhooks automatically
      await registerWebhooks(shop, accessToken);

      // Redirect back to Shopify Admin Embedding App screen
      const appHandle = Deno.env.get("SHOPIFY_APP_NAME") || "easy-whatsapp-marketing";
      const cleanShop = shop.replace(".myshopify.com", "");
      const redirectUrl = `https://admin.shopify.com/store/${cleanShop}/apps/${appHandle}`;
      
      console.log(`Shopify OAuth complete. Redirecting to embedded environment: ${redirectUrl}`);
      return Response.redirect(redirectUrl, 307);
    } catch (err) {
      console.error("Shopify OAuth callback execution error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      return new Response(`OAuth processing error: ${errorMsg}\nStack: ${errorStack}`, { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
});

async function registerWebhooks(shop: string, accessToken: string) {
  const SHOPIFY_APP_HOST = Deno.env.get("SHOPIFY_APP_HOST") || "";
  const topics = ["app/uninstalled", "checkouts/create", "checkouts/update", "orders/create"];
  const gatewayUrl = `https://${SHOPIFY_APP_HOST}/functions/v1/shopify-webhooks`;
  
  for (const topic of topics) {
    try {
      console.log(`Registering webhook topic ${topic} for ${shop}`);
      const res = await fetch(`https://${shop}/admin/api/2024-04/webhooks.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address: gatewayUrl,
            format: "json",
          },
        }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        console.error(`Failed to register webhook ${topic}:`, data);
      } else {
        console.log(`Successfully registered webhook ${topic}`);
      }
    } catch (err) {
      console.error(`Error registering webhook ${topic}:`, err);
    }
  }
}
