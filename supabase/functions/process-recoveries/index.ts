import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { sql } from "../shared/db.ts";

// Billing limit verifier
async function checkStoreBilling(storeId: number): Promise<{ allowed: boolean }> {
  try {
    const subResult = await sql`
      SELECT plan, message_limit, message_count 
      FROM subscriptions 
      WHERE store_id = ${storeId} AND status = 'ACTIVE'
      ORDER BY created_at DESC 
      LIMIT 1
    `;

    if (subResult.length === 0) {
      return { allowed: true }; // starter free tier defaults
    }

    const { plan, message_limit, message_count } = subResult[0];

    if (plan === 'PRO' || message_limit === -1) {
      return { allowed: true };
    }

    if (message_count < message_limit) {
      return { allowed: true };
    }

    // Over limit - log billing event
    await sql`
      INSERT INTO billing_events (store_id, event_type, details)
      VALUES (${storeId}, 'LIMIT_EXCEEDED_BLOCKED', ${JSON.stringify({ plan, limit: message_limit, count: message_count })})
    `;

    return { allowed: false };
  } catch (error) {
    console.error('Error checking billing limits in Scheduler:', error);
    return { allowed: false };
  }
}

serve(async (req) => {
  console.log(`[Cron Scheduler] Starting scan for eligible recoveries...`);
  
  try {
    // 1. Fetch stores with connected WhatsApp accounts
    const activeStores = await sql`
      SELECT s.id as store_id, s.shop_domain
      FROM stores s
      JOIN whatsapp_accounts wa ON wa.store_id = s.id
      WHERE wa.connected = true
    `;

    for (const store of activeStores) {
      const { store_id, shop_domain } = store;

      // 2. Fetch the active abandoned cart template
      const templateResult = await sql`
        SELECT variables, is_enabled 
        FROM message_templates 
        WHERE store_id = ${store_id} AND template_type = 'ABANDONED_CART' AND is_enabled = true
      `;
      if (templateResult.length === 0) continue;

      // 3. Fetch active delay rules
      const rules = await sql`
        SELECT delay_hours 
        FROM automation_rules 
        WHERE store_id = ${store_id} AND is_enabled = true
      `;
      if (rules.length === 0) continue;

      for (const rule of rules) {
        const delayHours = rule.delay_hours;
        const messageType = `ABANDONED_CART_${delayHours}H`;

        // 4. Query checkouts older than delay and not recovered
        const checkouts = await sql`
          SELECT ac.id, ac.customer_name, ac.customer_phone, ac.checkout_url, ac.total_amount
          FROM abandoned_checkouts ac
          WHERE ac.store_id = ${store_id}
            AND ac.recovered = false
            AND ac.customer_phone IS NOT NULL
            AND ac.created_at <= NOW() - (${delayHours} * INTERVAL '1 hour')
            AND ac.created_at >= NOW() - INTERVAL '7 days'
            AND NOT EXISTS (
              SELECT 1 
              FROM message_logs ml 
              WHERE ml.abandoned_checkout_id = ac.id 
                AND ml.message_type = ${messageType}
            )
        `;

        for (const checkout of checkouts) {
          // Verify billing rules
          const billing = await checkStoreBilling(store_id);
          if (!billing.allowed) {
            console.warn(`Billing limit exceeded for store: ${shop_domain}. Automation rules blocked.`);
            break; // Stop further checks for this store in this run
          }

          console.log(`[Scheduler] Inserting PENDING recovery message log for checkout ID: ${checkout.id}`);

          // 5. Insert log as PENDING (triggers DB Webhook to execute send-whatsapp Edge Function!)
          await sql`
            INSERT INTO message_logs 
              (store_id, abandoned_checkout_id, recipient_phone, message_type, status)
            VALUES (${store_id}, ${checkout.id}, ${checkout.customer_phone}, ${messageType}, 'PENDING')
          `;
        }
      }
    }

    return new Response('Scheduler execution completed successfully', { status: 200 });
  } catch (error) {
    console.error('Scheduler cron failed:', error);
    return new Response('Scheduler execution failed', { status: 500 });
  }
});
