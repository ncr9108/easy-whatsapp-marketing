import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { sql, getValidAccessToken } from "../shared/db.ts";
import { encryptToken, decryptToken } from "../shared/crypto.ts";

const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY") || "";
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") || "";
const SHOPIFY_APP_HOST = Deno.env.get("SHOPIFY_APP_HOST") || "";
const SHOPIFY_APP_NAME = Deno.env.get("SHOPIFY_APP_NAME") || "easy-whatsapp-marketing";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

// Validate App Bridge JWT Token
async function authenticateShopify(req: Request): Promise<{ auth?: { shop: string; storeId: number; storeToken: string }; error?: string }> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return { error: "Missing Authorization header" };
    if (!authHeader.startsWith("Bearer ")) return { error: "Authorization header must start with Bearer" };

    const token = authHeader.split(" ")[1];
    if (!token) return { error: "Token is empty" };
    
    // Import raw Shopify secret key as CryptoKey for signature checking
    const rawKey = new TextEncoder().encode(SHOPIFY_API_SECRET);
    const key = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify token using djwt
    let payload;
    try {
      payload = await verify(token, key);
    } catch (err) {
      return { error: `djwt verify failed: ${err.message}` };
    }

    const shop = (payload.dest as string).replace("https://", "");

    // Load store access token
    const storeResult = await sql`SELECT id, access_token FROM stores WHERE shop_domain = ${shop}`;
    if (storeResult.length === 0) return { error: `Store not found in database for domain: ${shop}` };

    return {
      auth: {
        shop,
        storeId: storeResult[0].id,
        storeToken: storeResult[0].access_token,
      }
    };
  } catch (error) {
    console.error("JWT Authentication failed:", error);
    return { error: `Fatal auth handler exception: ${error.message}` };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Run inline migrations to ensure new Meta template registration columns exist
  try {
    await sql`
      ALTER TABLE message_templates 
      ADD COLUMN IF NOT EXISTS meta_template_name VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS meta_status VARCHAR(50) DEFAULT 'NOT_REGISTERED',
      ADD COLUMN IF NOT EXISTS meta_error TEXT DEFAULT NULL;
    `;
  } catch (err) {
    console.error("Database schema sync warning:", err);
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // Temporary public debug endpoint to inspect environment keys and DB state
  if (path.endsWith("/public/debug")) {
    try {
      const templates = await sql`SELECT id, store_id, template_type, body_text, variables, is_enabled, meta_template_name, meta_status, meta_error FROM message_templates`;
      const accounts = await sql`SELECT id, store_id, business_account_id, phone_number_id, connected, phone_number, last_sync_at FROM whatsapp_accounts`;
      return new Response(JSON.stringify({ 
        apiKey: SHOPIFY_API_KEY, 
        appName: SHOPIFY_APP_NAME,
        appHost: SHOPIFY_APP_HOST,
        hasSecret: !!SHOPIFY_API_SECRET,
        templates,
        accounts
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (dbErr) {
      return new Response(JSON.stringify({ error: `Debug DB error: ${dbErr.message}` }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }
  
  // Temporary endpoint to trigger a mock checkout and execute recovery dispatch instantly
  if (path.endsWith("/public/trigger-test")) {
    const shop = url.searchParams.get("shop") || "mobile-cms-sgxzrn9v.myshopify.com";
    const phone = url.searchParams.get("phone");

    if (!phone) {
      return new Response(JSON.stringify({ error: "Missing 'phone' query parameter. Pass e.g. ?phone=1234567890" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    try {
      console.log(`[Test Trigger] Starting test recovery trigger for shop: ${shop}, phone: ${phone}`);
      
      // 1. Get store ID
      const storeRes = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
      if (storeRes.length === 0) {
        return new Response(JSON.stringify({ error: `Store ${shop} not found in database.` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const storeId = storeRes[0].id;

      // 2. Ensure 6h automation rule is enabled for this store
      await sql`
        INSERT INTO automation_rules (store_id, delay_hours, is_enabled)
        VALUES (${storeId}, 6, true)
        ON CONFLICT (store_id, delay_hours) DO UPDATE SET is_enabled = true
      `;

      // 3. Create a unique checkout_id
      const mockCheckoutId = `test_checkout_${Date.now()}`;

      // 4. Insert a mock abandoned checkout dated 7 hours ago
      const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
      const checkoutInsert = await sql`
        INSERT INTO abandoned_checkouts 
          (store_id, checkout_id, customer_name, customer_phone, customer_email, checkout_url, total_amount, recovered, created_at)
        VALUES 
          (${storeId}, ${mockCheckoutId}, 'Test Customer', ${phone}, 'test@example.com', 'https://store.myshopify.com/checkouts/test-123', 99.99, false, ${sevenHoursAgo})
        RETURNING id
      `;
      const checkoutRecordId = checkoutInsert[0].id;

      // 5. Trigger the recovery process by running the process-recoveries logic
      const appHost = Deno.env.get("SHOPIFY_APP_HOST") || "";
      const processRes = await fetch(`https://${appHost}/functions/v1/process-recoveries`, {
        method: "POST"
      });
      const processText = await processRes.text();

      // Wait a brief moment to allow the asynchronous database webhook to execute the message delivery
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 6. Fetch the result logs
      const logs = await sql`
        SELECT id, recipient_phone, message_type, status, error_message, created_at 
        FROM message_logs 
        WHERE abandoned_checkout_id = ${checkoutRecordId}
      `;

      return new Response(JSON.stringify({ 
        message: "Test checkout created and recovery scan triggered!",
        checkoutId: mockCheckoutId,
        checkoutRecordId,
        schedulerResponse: processText,
        generatedLogs: logs
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (err) {
      console.error("[Test Trigger] Error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: errorMsg }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  // Temporary endpoint to manually trigger a recovery message for the latest abandoned checkout instantly
  if (path.endsWith("/public/trigger-latest-recovery")) {
    const shop = url.searchParams.get("shop") || "mobile-cms-sgxzrn9v.myshopify.com";

    try {
      console.log(`[Manual Trigger] Querying latest abandoned checkout for shop: ${shop}`);
      
      // 1. Get store ID
      const storeRes = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
      if (storeRes.length === 0) {
        return new Response(JSON.stringify({ error: `Store ${shop} not found in database.` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const storeId = storeRes[0].id;

      // 2. Fetch latest abandoned checkout that hasn't been recovered yet
      const checkoutRes = await sql`
        SELECT id, customer_name, customer_phone, checkout_url 
        FROM abandoned_checkouts 
        WHERE store_id = ${storeId} AND recovered = false 
        ORDER BY created_at DESC 
        LIMIT 1
      `;

      if (checkoutRes.length === 0) {
        return new Response(JSON.stringify({ error: "No abandoned checkouts found for this store." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const checkout = checkoutRes[0];

      // If a custom URL parameter is provided, update it in the database for testing
      const customUrl = url.searchParams.get("url");
      if (customUrl) {
        await sql`
          UPDATE abandoned_checkouts 
          SET checkout_url = ${customUrl} 
          WHERE id = ${checkout.id}
        `;
        checkout.checkout_url = customUrl;
      }

      if (!checkout.customer_phone) {
        return new Response(JSON.stringify({ error: `The latest abandoned checkout (ID: ${checkout.id}) does not have a phone number saved.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      console.log(`[Manual Trigger] Found checkout ID: ${checkout.id}, phone: ${checkout.customer_phone}. Creating PENDING log...`);

      // 3. Insert PENDING log directly (this fires the Database Webhook to send via send-whatsapp Edge Function!)
      const logInsert = await sql`
        INSERT INTO message_logs 
          (store_id, abandoned_checkout_id, recipient_phone, message_type, status)
        VALUES 
          (${storeId}, ${checkout.id}, ${checkout.customer_phone}, 'ABANDONED_CART_6H', 'PENDING')
        RETURNING id
      `;
      const logId = logInsert[0].id;

      // Wait a brief moment to allow the asynchronous database webhook to execute the message delivery
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 4. Fetch the result log status
      const logStatus = await sql`
        SELECT id, recipient_phone, status, error_message, created_at 
        FROM message_logs 
        WHERE id = ${logId}
      `;

      return new Response(JSON.stringify({ 
        message: "Manual trigger processed successfully!",
        checkoutId: checkout.id,
        customerName: checkout.customer_name,
        recipientPhone: checkout.customer_phone,
        logDetails: logStatus[0]
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (err) {
      console.error("[Manual Trigger] Error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: errorMsg }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  // Temporary endpoint to check delivery status of the latest message log using Meta API
  if (path.endsWith("/public/check-delivery")) {
    const shop = url.searchParams.get("shop") || "mobile-cms-sgxzrn9v.myshopify.com";

    try {
      console.log(`[Check Delivery] Fetching latest message log for shop: ${shop}`);
      
      // 1. Get store ID
      const storeRes = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
      if (storeRes.length === 0) {
        return new Response(JSON.stringify({ error: `Store ${shop} not found in database.` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const storeId = storeRes[0].id;

      // 2. Fetch the latest log
      const logRes = await sql`
        SELECT id, recipient_phone, message_type, status, whatsapp_message_id, error_message, created_at 
        FROM message_logs 
        WHERE store_id = ${storeId}
        ORDER BY created_at DESC 
        LIMIT 5
      `;

      if (logRes.length === 0) {
        return new Response(JSON.stringify({ error: "No message logs found for this store." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Fetch credentials to query Meta
      const waResult = await sql`
        SELECT access_token_encrypted 
        FROM whatsapp_accounts 
        WHERE store_id = ${storeId} AND connected = true
      `;

      if (waResult.length === 0) {
        return new Response(JSON.stringify({ error: "WhatsApp account credentials not connected." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const accessToken = await decryptToken(waResult[0].access_token_encrypted);

      // 4. Try querying Meta for each of the logs that have a whatsapp_message_id
      const logsWithMetaStatus = await Promise.all(logRes.map(async (log: any) => {
        if (!log.whatsapp_message_id) {
          return { ...log, meta_api_status: "No WhatsApp Message ID found in log" };
        }

        try {
          // Query Meta Graph API for message status
          const metaRes = await fetch(`https://graph.facebook.com/v19.0/${log.whatsapp_message_id}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const metaJson = await metaRes.json();
          return {
            ...log,
            meta_api_response: metaJson
          };
        } catch (metaErr) {
          return {
            ...log,
            meta_api_status: `Failed to query Meta: ${metaErr.message}`
          };
        }
      }));

      return new Response(JSON.stringify({ 
        message: "Latest message logs retrieved and queried against Meta Graph API",
        logs: logsWithMetaStatus
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (err) {
      console.error("[Check Delivery] Error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: errorMsg }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  // Temporary endpoint to reset the abandoned cart template to a clean UTILITY layout
  if (path.endsWith("/public/set-utility-template")) {
    const shop = url.searchParams.get("shop") || "mobile-cms-sgxzrn9v.myshopify.com";

    try {
      console.log(`[Set Utility Template] Updating template for shop: ${shop}`);
      
      // 1. Get store ID
      const storeRes = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
      if (storeRes.length === 0) {
        return new Response(JSON.stringify({ error: `Store ${shop} not found in database.` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const storeId = storeRes[0].id;

      // 2. Update to a clean transactional/utility message text
      const newBody = "Hi {{customer_name}}, your shopping session was saved. You can resume your checkout here: {{checkout_url}}";
      
      await sql`
        UPDATE message_templates 
        SET 
          body_text = ${newBody},
          variables = '["customer_name", "checkout_url"]'::jsonb,
          meta_status = 'NOT_REGISTERED',
          meta_template_name = NULL,
          meta_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE store_id = ${storeId} AND template_type = 'ABANDONED_CART'
      `;

      return new Response(JSON.stringify({ 
        message: "Successfully reset abandoned cart template in database to UTILITY layout!",
        newBodyText: newBody
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (err) {
      console.error("[Set Utility Template] Error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: errorMsg }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  // Handle public billing callback endpoint directly
  if (path.includes("/billing-callback")) {
    const shop = url.searchParams.get("shop");
    const plan = url.searchParams.get("plan");
    const chargeId = url.searchParams.get("charge_id");

    if (!shop || !plan || !chargeId) {
      return new Response("Missing parameters", { status: 400 });
    }

    try {
      console.log(`Billing callback. Verifying charge: ${chargeId} for ${shop}`);
      const storeRes = await sql`SELECT id FROM stores WHERE shop_domain = ${shop}`;
      if (storeRes.length > 0) {
        const storeId = storeRes[0].id;
        const accessToken = await getValidAccessToken(shop);

        // Verify charge status with Shopify REST API
        const shopifyChargeRes = await fetch(
          `https://${shop}/admin/api/2024-04/recurring_application_charges/${chargeId}.json`,
          {
            headers: {
              "X-Shopify-Access-Token": accessToken,
            }
          }
        );

        const chargeData = await shopifyChargeRes.json();
        const charge = chargeData.recurring_application_charge;

        if (charge && (charge.status === 'active' || charge.status === 'accepted')) {
          const price = parseFloat(charge.price);
          const limit = plan === 'PRO' ? -1 : (plan === 'GROWTH' ? 5000 : 500);

          await sql`UPDATE stores SET plan = ${plan} WHERE id = ${storeId}`;
          await sql`
            INSERT INTO subscriptions (store_id, shopify_subscription_id, status, plan, price, message_limit, message_count, billing_on)
            VALUES (${storeId}, ${chargeId}, 'ACTIVE', ${plan}, ${price}, ${limit}, 0, CURRENT_TIMESTAMP + INTERVAL '30 days')
            ON CONFLICT (shopify_subscription_id) 
            DO UPDATE SET status = 'ACTIVE', plan = EXCLUDED.plan, price = EXCLUDED.price, message_limit = EXCLUDED.message_limit
          `;
        }
      }
      
      const cleanShop = shop.replace(".myshopify.com", "");
      return Response.redirect(`https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_APP_NAME}`, 307);
    } catch (error) {
      console.error("Billing Callback verify error:", error);
      return new Response("Internal verification error", { status: 500 });
    }
  }

  // Authenticate other routes
  const authResult = await authenticateShopify(req);
  if (authResult.error) {
    console.error("Shopify auth verification failed:", authResult.error);
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const { shop, storeId, storeToken } = authResult.auth!;

  try {
    // ----------------------------------------------------
    // WHATSAPP CONNECT ENDPOINTS
    // ----------------------------------------------------
    if (path.endsWith("/whatsapp")) {
      const waResult = await sql`
        SELECT business_account_id, phone_number_id, connected, phone_number, last_sync_at
        FROM whatsapp_accounts WHERE store_id = ${storeId}
      `;
      const data = waResult.length > 0 ? waResult[0] : { connected: false };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path.endsWith("/whatsapp/connect")) {
      const { businessAccountId, phoneNumberId, accessToken } = await req.json();

      if (!businessAccountId || !phoneNumberId || !accessToken) {
        return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: corsHeaders });
      }

      // Validate with Meta API
      const metaRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const metaData = await metaRes.json();
      if (!metaRes.ok) {
        return new Response(JSON.stringify({ error: `Meta check failed: ${metaData.error?.message || 'Invalid token'}` }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Encrypt and save
      const encrypted = await encryptToken(accessToken);
      const displayPhone = metaData.display_phone_number || '';

      const updatedWa = await sql`
        INSERT INTO whatsapp_accounts (store_id, business_account_id, phone_number_id, access_token_encrypted, connected, phone_number, last_sync_at)
        VALUES (${storeId}, ${businessAccountId}, ${phoneNumberId}, ${encrypted}, true, ${displayPhone}, CURRENT_TIMESTAMP)
        ON CONFLICT (store_id) DO UPDATE SET
          business_account_id = EXCLUDED.business_account_id,
          phone_number_id = EXCLUDED.phone_number_id,
          access_token_encrypted = EXCLUDED.access_token_encrypted,
          connected = true,
          phone_number = EXCLUDED.phone_number,
          last_sync_at = CURRENT_TIMESTAMP
        RETURNING connected, phone_number, business_account_id, phone_number_id, last_sync_at
      `;

      return new Response(JSON.stringify({ message: "WhatsApp connected successfully", data: updatedWa[0] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path.endsWith("/whatsapp/disconnect")) {
      await sql`
        UPDATE whatsapp_accounts 
        SET connected = false, access_token_encrypted = '', last_sync_at = CURRENT_TIMESTAMP
        WHERE store_id = ${storeId}
      `;
      return new Response(JSON.stringify({ message: "Disconnected" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ----------------------------------------------------
    // AUTOMATIONS & TEMPLATES ENDPOINTS
    // ----------------------------------------------------
    if (path.endsWith("/automation")) {
      const templates = await sql`SELECT id, template_type, body_text, variables, is_enabled, meta_template_name, meta_status, meta_error FROM message_templates WHERE store_id = ${storeId}`;
      const rules = await sql`SELECT id, delay_hours, is_enabled FROM automation_rules WHERE store_id = ${storeId} ORDER BY delay_hours ASC`;
      
      // Auto-sync status from Meta if a template has been registered and is still in PENDING state
      const waResult = await sql`
        SELECT business_account_id, access_token_encrypted 
        FROM whatsapp_accounts 
        WHERE store_id = ${storeId} AND connected = true
      `;
      
      if (waResult.length > 0) {
        const { business_account_id, access_token_encrypted } = waResult[0];
        let tokenDecrypted = null;
        
        for (const template of templates) {
          if (template.meta_template_name && template.meta_status === 'PENDING') {
            try {
              if (!tokenDecrypted) {
                tokenDecrypted = await decryptToken(access_token_encrypted);
              }
              
              const metaRes = await fetch(
                `https://graph.facebook.com/v19.0/${business_account_id}/message_templates?name=${template.meta_template_name}`,
                {
                  headers: { Authorization: `Bearer ${tokenDecrypted}` }
                }
              );
              
              if (metaRes.ok) {
                const metaJson = await metaRes.json();
                const remoteTemplate = metaJson.data?.find((t: any) => t.name === template.meta_template_name);
                if (remoteTemplate && remoteTemplate.status && remoteTemplate.status !== template.meta_status) {
                  console.log(`[Auto Sync Status] Updating template ${template.meta_template_name} status from ${template.meta_status} to ${remoteTemplate.status}`);
                  await sql`
                    UPDATE message_templates
                    SET meta_status = ${remoteTemplate.status}, meta_error = ${JSON.stringify(remoteTemplate)}
                    WHERE id = ${template.id}
                  `;
                  // Update local references returned to UI
                  template.meta_status = remoteTemplate.status;
                  template.meta_error = JSON.stringify(remoteTemplate);
                }
              }
            } catch (syncErr) {
              console.error(`[Auto Sync Status] Failed to query Meta WABA for ${template.meta_template_name}:`, syncErr);
            }
          }
        }
      }

      return new Response(JSON.stringify({ templates, rules }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path.endsWith("/automation/template")) {
      const { templateType, bodyText, variables, isEnabled } = await req.json();
      
      const updatedTemplate = await sql`
        INSERT INTO message_templates (store_id, template_type, body_text, variables, is_enabled, meta_status, meta_error)
        VALUES (${storeId}, ${templateType}, ${bodyText}, ${JSON.stringify(variables)}::jsonb, ${isEnabled}, 'NOT_REGISTERED', NULL)
        ON CONFLICT (store_id, template_type) DO UPDATE SET
          body_text = EXCLUDED.body_text,
          variables = EXCLUDED.variables,
          is_enabled = EXCLUDED.is_enabled,
          meta_status = 'NOT_REGISTERED',
          meta_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, template_type, body_text, variables, is_enabled, meta_template_name, meta_status, meta_error
      `;

      return new Response(JSON.stringify({ template: updatedTemplate[0] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path.endsWith("/automation/template/register")) {
      const { templateType } = await req.json();
      
      if (!templateType) {
        return new Response(JSON.stringify({ error: "Missing templateType" }), { status: 400, headers: corsHeaders });
      }

      // Fetch template details
      const templateRes = await sql`
        SELECT body_text, variables, meta_template_name
        FROM message_templates 
        WHERE store_id = ${storeId} AND template_type = ${templateType}
      `;

      if (templateRes.length === 0) {
        return new Response(JSON.stringify({ error: "Template not found. Save the template first." }), { status: 404, headers: corsHeaders });
      }

      const template = templateRes[0];

      // Fetch WhatsApp Account credentials
      const waResult = await sql`
        SELECT business_account_id, phone_number_id, access_token_encrypted 
        FROM whatsapp_accounts 
        WHERE store_id = ${storeId} AND connected = true
      `;

      if (waResult.length === 0) {
        return new Response(JSON.stringify({ error: "WhatsApp account is not connected" }), { status: 400, headers: corsHeaders });
      }

      const { business_account_id, phone_number_id, access_token_encrypted } = waResult[0];

      // Decrypt token
      const accessToken = await decryptToken(access_token_encrypted);

      // Versioning: Determine next version
      let nextVersion = 1;
      if (template.meta_template_name) {
        const match = template.meta_template_name.match(/_v(\d+)$/);
        if (match) {
          nextVersion = parseInt(match[1]) + 1;
        }
      }
      const registerName = `${templateType.toLowerCase()}_v${nextVersion}`;

      // Convert variables (e.g. {{customer_name}}) to positional parameters ({{1}}, {{2}}, etc.)
      let bodyTextMeta = template.body_text;
      let variables = template.variables;
      if (typeof variables === 'string') {
        try {
          variables = JSON.parse(variables);
        } catch (e) {
          console.error("[Sync Meta Template] Failed to parse template.variables JSON string:", e);
        }
      }
      const variablesArray = Array.isArray(variables) ? variables : [];
      variablesArray.forEach((v: string, index: number) => {
        bodyTextMeta = bodyTextMeta.replaceAll(`{{${v}}}`, `{{${index + 1}}}`);
      });

      // Meta rules forbid templates from starting or ending directly with a placeholder.
      if (bodyTextMeta.trim().startsWith("{{")) {
        bodyTextMeta = "Hello " + bodyTextMeta.trim();
      }
      if (bodyTextMeta.trim().endsWith("}}")) {
        if (templateType === 'ABANDONED_CART') {
          bodyTextMeta = bodyTextMeta.trim() + ". Happy Shopping!";
        } else {
          bodyTextMeta = bodyTextMeta.trim() + ". Thank you!";
        }
      }

      console.log(`[Sync Meta Template] Registering name: ${registerName} on WABA: ${business_account_id}`);
      
      // Formulate mock sample values for variables to satisfy Meta's mandatory "example" field requirement
      const mockValues: Record<string, string> = {
        customer_name: 'John Doe',
        store_name: 'PremiumStore',
        checkout_url: 'https://www.shopify.com',
        discount_code: 'WELCOME10',
        order_number: '#18472',
        order_total: '$120.00',
        tracking_url: 'https://track.package/1a2b3c'
      };

      const exampleValues = variablesArray.map((v: string) => mockValues[v] || 'Sample');

      const bodyComponent: any = {
        type: "BODY",
        text: bodyTextMeta,
      };

      if (exampleValues.length > 0) {
        bodyComponent.example = {
          body_text: [ exampleValues ]
        };
      }

      const payloadMeta = {
        name: registerName,
        category: "UTILITY",
        language: "en_US",
        components: [ bodyComponent ]
      };

      try {
        const metaResponse = await fetch(`https://graph.facebook.com/v19.0/${business_account_id}/message_templates`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payloadMeta),
        });

        const metaResult = await metaResponse.json();

        if (metaResponse.ok) {
          const status = metaResult.status || 'PENDING';
          const debugInfo = JSON.stringify(metaResult);
          
          const updatedTemplate = await sql`
            UPDATE message_templates
            SET 
              meta_template_name = ${registerName},
              meta_status = ${status},
              meta_error = ${debugInfo},
              updated_at = CURRENT_TIMESTAMP
            WHERE store_id = ${storeId} AND template_type = ${templateType}
            RETURNING id, template_type, body_text, variables, is_enabled, meta_template_name, meta_status, meta_error
          `;
          
          return new Response(JSON.stringify({ 
            message: "Template registered with Meta successfully.", 
            template: updatedTemplate[0] 
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else {
          const fullError = JSON.stringify(metaResult);
          console.error(`[Sync Meta Template] Meta API failed: ${fullError}`);
          
          const updatedTemplate = await sql`
            UPDATE message_templates
            SET 
              meta_template_name = ${registerName},
              meta_status = 'FAILED',
              meta_error = ${fullError},
              updated_at = CURRENT_TIMESTAMP
            WHERE store_id = ${storeId} AND template_type = ${templateType}
            RETURNING id, template_type, body_text, variables, is_enabled, meta_template_name, meta_status, meta_error
          `;
          
          return new Response(JSON.stringify({ 
            error: metaResult.error?.message || "Meta API error",
            template: updatedTemplate[0]
          }), {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (err) {
        console.error("[Sync Meta Template] API exception:", err);
        return new Response(JSON.stringify({ error: `Connection exception: ${err.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (path.endsWith("/automation/rules")) {
      const { rules } = await req.json(); // [{ delayHours: 6, isEnabled: true }]
      
      // Update rules in transaction
      await sql.begin(async (sqlTrans) => {
        for (const rule of rules) {
          await sqlTrans`
            INSERT INTO automation_rules (store_id, delay_hours, is_enabled)
            VALUES (${storeId}, ${rule.delayHours}, ${rule.isEnabled})
            ON CONFLICT (store_id, delay_hours) DO UPDATE SET is_enabled = EXCLUDED.is_enabled
          `;
        }
      });

      const updatedRules = await sql`SELECT id, delay_hours, is_enabled FROM automation_rules WHERE store_id = ${storeId} ORDER BY delay_hours ASC`;
      return new Response(JSON.stringify({ rules: updatedRules }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ----------------------------------------------------
    // ANALYTICS ENDPOINTS
    // ----------------------------------------------------
    if (path.endsWith("/analytics")) {
      // 1. KPI cards counts
      const stats = await sql`
        SELECT 
          COALESCE(COUNT(ac.id), 0) as total_abandoned,
          COALESCE(SUM(CASE WHEN ac.recovered = true THEN 1 ELSE 0 END), 0) as total_recovered,
          COALESCE(SUM(CASE WHEN ac.recovered = true THEN ac.total_amount ELSE 0 END), 0) as total_revenue
        FROM abandoned_checkouts ac WHERE ac.store_id = ${storeId}
      `;
      const summary = stats[0];

      const totalAbandoned = parseInt(summary.total_abandoned);
      const totalRecovered = parseInt(summary.total_recovered);
      const recoveryRate = totalAbandoned > 0 ? ((totalRecovered / totalAbandoned) * 100).toFixed(1) : '0.0';

      // 2. WhatsApp logs
      const msgStats = await sql`
        SELECT 
          COALESCE(COUNT(id), 0) as total_messages,
          COALESCE(SUM(CASE WHEN status IN ('SENT', 'DELIVERED', 'READ') THEN 1 ELSE 0 END), 0) as total_sent,
          COALESCE(SUM(CASE WHEN status IN ('DELIVERED', 'READ') THEN 1 ELSE 0 END), 0) as total_delivered,
          COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) as total_failed
        FROM message_logs WHERE store_id = ${storeId}
      `;
      const logs = msgStats[0];

      const messagesSent = parseInt(logs.total_sent);
      const messagesDelivered = parseInt(logs.total_delivered);
      const deliveryRate = messagesSent > 0 ? ((messagesDelivered / messagesSent) * 100).toFixed(1) : '0.0';

      // 3. Daily Recovery Timeline (Last 30 Days)
      const daily = await sql`
        SELECT 
          TO_CHAR(updated_at, 'YYYY-MM-DD') as date,
          COUNT(id) as count,
          COALESCE(SUM(total_amount), 0) as revenue
        FROM abandoned_checkouts
        WHERE store_id = ${storeId} AND recovered = true AND updated_at >= NOW() - INTERVAL '30 days'
        GROUP BY TO_CHAR(updated_at, 'YYYY-MM-DD')
        ORDER BY date ASC
      `;

      // 4. Weekly Recovery Timeline
      const weekly = await sql`
        SELECT 
          TO_CHAR(DATE_TRUNC('week', updated_at), 'YYYY-"W"IW') as week,
          COUNT(id) as count,
          COALESCE(SUM(total_amount), 0) as revenue
        FROM abandoned_checkouts
        WHERE store_id = ${storeId} AND recovered = true AND updated_at >= NOW() - INTERVAL '90 days'
        GROUP BY DATE_TRUNC('week', updated_at), week
        ORDER BY week ASC
      `;

      // 5. Recent message logs (last 50 logs)
      const logsList = await sql`
        SELECT 
          id,
          recipient_phone,
          message_type,
          status,
          error_message,
          created_at
        FROM message_logs
        WHERE store_id = ${storeId}
        ORDER BY created_at DESC
        LIMIT 50
      `;

      return new Response(JSON.stringify({
        metrics: {
          abandonedCarts: totalAbandoned,
          recoveredCarts: totalRecovered,
          recoveryRate: parseFloat(recoveryRate),
          revenueRecovered: parseFloat(summary.total_revenue || 0),
          messagesSent,
          messagesDelivered,
          messagesFailed: parseInt(logs.total_failed),
          deliveryRate: parseFloat(deliveryRate),
        },
        charts: {
          daily: daily.map(row => ({
            date: row.date,
            recoveredCount: parseInt(row.count),
            revenue: parseFloat(row.revenue),
          })),
          weekly: weekly.map(row => ({
            week: row.week,
            recoveredCount: parseInt(row.count),
            revenue: parseFloat(row.revenue),
          })),
        },
        recentLogs: logsList.map(row => ({
          id: String(row.id),
          phone: row.recipient_phone,
          type: row.message_type === 'ORDER_CONFIRMATION' ? 'Order Confirmation' : `Abandoned Cart ${row.message_type.replace('ABANDONED_CART_', '')}`,
          status: row.status,
          error: row.error_message,
          time: row.created_at.toISOString(),
        }))
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ----------------------------------------------------
    // BILLING & PLAN ENDPOINTS
    // ----------------------------------------------------
    if (path.endsWith("/billing/status")) {
      const activeSub = await sql`
        SELECT plan, price, status, message_limit, message_count, billing_on
        FROM subscriptions WHERE store_id = ${storeId} AND status = 'ACTIVE'
        ORDER BY created_at DESC LIMIT 1
      `;
      
      const sub = activeSub.length > 0 ? activeSub[0] : {
        plan: 'STARTER', price: 5.00, status: 'ACTIVE', message_limit: 500, message_count: 0
      };

      return new Response(JSON.stringify({
        plan: sub.plan,
        price: parseFloat(sub.price),
        status: sub.status,
        messageLimit: sub.message_limit,
        messageCount: sub.message_count,
        billingOn: sub.billing_on,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path.endsWith("/billing/create")) {
      const { planName } = await req.json();
      
      const prices: Record<string, number> = { STARTER: 5.00, GROWTH: 15.00, PRO: 49.00 };
      const price = prices[planName];

      if (!price) {
        return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400, headers: corsHeaders });
      }

      const returnUrl = `https://${SHOPIFY_APP_HOST}/functions/v1/api-gateway/billing-callback?shop=${shop}&plan=${planName}`;

      // Request Recurring Application Charge from Shopify via REST API
      const shopifyChargeRes = await fetch(
        `https://${shop}/admin/api/2024-04/recurring_application_charges.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": await getValidAccessToken(shop),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recurring_application_charge: {
              name: `EasyWhatsAppMarketing ${planName} Plan`,
              price,
              return_url: returnUrl,
              test: true, // test charges in sandbox mode
            }
          })
        }
      );

      const chargeData = await shopifyChargeRes.json();
      const charge = chargeData.recurring_application_charge;

      if (!shopifyChargeRes.ok || !charge) {
        console.error("Shopify billing API error response:", chargeData);
        return new Response(JSON.stringify({ error: "Failed to initiate charge with Shopify" }), {
          status: 400,
          headers: corsHeaders
        });
      }

      return new Response(JSON.stringify({ confirmationUrl: charge.confirmation_url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Endpoint route not mapped" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Gateway exception handler:", error);
    return new Response(JSON.stringify({ error: "Internal Gateway server exception" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
