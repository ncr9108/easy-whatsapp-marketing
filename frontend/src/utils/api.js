import axios from 'axios';

// relative path which is proxied locally and resolved directly in production
const api = axios.create({
  baseURL: '/functions/v1/api-gateway',
  headers: {
    'Content-Type': 'application/json',
  }
});

// Interceptor to inject Shopify JWT Token on every API request
api.interceptors.request.use(
  async (config) => {
    console.log(`[API Interceptor] Request starting for URL: ${config.url}`);
    try {
      if (window.shopify && typeof window.shopify.idToken === 'function') {
        console.log('[API Interceptor] App Bridge found. Fetching shopify.idToken()...');
        const token = await window.shopify.idToken();
        console.log('[API Interceptor] Token retrieved successfully.');
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        console.warn('[API Interceptor] window.shopify or shopify.idToken is not defined. Skipping header.');
      }
    } catch (error) {
      console.error('[API Interceptor] Exception caught fetching token:', error);
    }
    return config;
  },
  (error) => {
    console.error('[API Interceptor] Request error hook:', error);
    return Promise.reject(error);
  }
);

// Response interceptor to catch authorization/reauth errors
api.interceptors.response.use(
  (response) => {
    console.log(`[API Interceptor] Response received with status ${response.status} for: ${response.config.url}`);
    return response;
  },
  (error) => {
    const status = error.response?.status;
    console.error('[API Interceptor] Response error caught:', status, error.message);
    
    // Redirect to OAuth install flow if unauthorized (401) or forbidden (403)
    if (status === 401 || status === 403) {
      const errorDetail = error.response?.data?.error || '';
      console.warn('[API Interceptor] Re-auth checking details:', errorDetail);
      
      // Prevent infinite redirect loops if token verification is failing at signature/crypto level
      if (errorDetail.includes('djwt verify failed') || errorDetail.includes('Fatal auth handler exception')) {
        const alertMsg = `Shopify API Token Verification Failed.\n\nDetail: ${errorDetail}\n\nThis usually means the SHOPIFY_API_SECRET configured in Supabase secrets is incorrect. Please verify your Partner Dashboard keys.`;
        console.error(alertMsg);
        alert(alertMsg);
        return Promise.reject(error);
      }

      console.warn('[API Interceptor] Re-auth required trigger. Redirecting to OAuth.');
      if (window.shopify) {
        const urlParams = new URLSearchParams(window.location.search);
        const shop = urlParams.get('shop');
        if (shop) {
          // Redirect the parent frame to the installation URL
          window.top.location.href = `/functions/v1/shopify-auth?shop=${shop}`;
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
