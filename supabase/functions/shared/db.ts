import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

// Read database URL from either system-injected SUPABASE_DB_URL or custom DATABASE_URL
const connectionString = Deno.env.get('DATABASE_URL') || Deno.env.get('SUPABASE_DB_URL') || '';

if (!connectionString) {
  console.warn('Warning: Database connection string (DATABASE_URL / SUPABASE_DB_URL) is missing.');
}

// Disable prepared statements for transaction mode pooler
export const sql = postgres(connectionString, {
  prepare: false,
  ssl: 'require'
});

const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY") || "";
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") || "";

export async function getValidAccessToken(shop: string): Promise<string> {
  const storeRes = await sql`SELECT id, shop_domain, access_token, refresh_token, expires_at FROM stores WHERE shop_domain = ${shop}`;
  if (storeRes.length === 0) {
    throw new Error(`Store ${shop} not found in database`);
  }
  const store = storeRes[0];
  
  if (!store.expires_at) {
    return store.access_token;
  }
  
  const expiresAt = new Date(store.expires_at).getTime();
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
  
  if (Date.now() + bufferTime < expiresAt) {
    return store.access_token;
  }
  
  if (!store.refresh_token) {
    return store.access_token;
  }
  
  console.log(`[Token Refresh] Access token for ${shop} is expiring soon. Refreshing...`);
  
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        grant_type: "refresh_token",
        refresh_token: store.refresh_token,
      }),
    });
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify token refresh API failed: ${errText}`);
    }
    
    const tokenData = await res.json();
    const newAccessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token || store.refresh_token;
    const expiresSeconds = tokenData.expires_in || 3600;
    const newExpiresAt = new Date(Date.now() + expiresSeconds * 1000);
    
    await sql`
      UPDATE stores
      SET 
        access_token = ${newAccessToken},
        refresh_token = ${newRefreshToken},
        expires_at = ${newExpiresAt},
        updated_at = CURRENT_TIMESTAMP
      WHERE shop_domain = ${shop}
    `;
    
    console.log(`[Token Refresh] Token successfully refreshed for ${shop}`);
    return newAccessToken;
  } catch (refreshErr) {
    console.error(`[Token Refresh] Error refreshing token for ${shop}:`, refreshErr);
    return store.access_token;
  }
}

export default sql;
