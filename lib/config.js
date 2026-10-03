import 'dotenv/config';

export function loadConfig(env = process.env) {
  let automatic = {};
  try {
    automatic = JSON.parse(env.FIREBASE_CONFIG || '{}');
  } catch {
    /* Optional platform config. */
  }
  const projectId = env.FB_PROJECT_ID || automatic.projectId || env.GCLOUD_PROJECT || '';
  const firebase = {
    apiKey: env.FB_WEB_API_KEY || '',
    authDomain: env.FB_WEB_AUTH_DOMAIN || '',
    projectId,
    appId: env.FB_WEB_APP_ID || '',
    messagingSenderId: env.FB_WEB_MESSAGING_SENDER_ID || '',
  };
  const validLink = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
    } catch {
      return '';
    }
  };
  const configured = Object.entries(firebase)
    .filter(([key]) => key !== 'messagingSenderId')
    .every(([, value]) => value && !value.includes('your-'));
  const cloudinary = {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
  };
  cloudinary.configured =
    /^[a-zA-Z0-9_-]+$/.test(cloudinary.cloudName) &&
    /^\d+$/.test(cloudinary.apiKey) &&
    !!cloudinary.apiSecret &&
    !/^(<|YOUR_|your-|replace-)/.test(cloudinary.apiSecret);
  return {
    env,
    cloudinary,
    projectId,
    firebase,
    configured,
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === '1' ? 1 : false,
    publicSiteUrl: env.PUBLIC_SITE_URL || '',
    rateLimitSalt: env.RATE_LIMIT_SALT || '',
    public: {
      firebase: configured ? firebase : null,
      configured,
      uploadsConfigured: cloudinary.configured,
      social: {
        facebook: validLink(env.SOCIAL_FACEBOOK),
        tiktok: validLink(env.SOCIAL_TIKTOK),
        instagram: validLink(env.SOCIAL_INSTAGRAM),
        youtube: validLink(env.SOCIAL_YOUTUBE || 'https://www.youtube.com/@SanghaboPahasara'),
        website: validLink(env.SCHOOL_WEBSITE || 'https://srisanghabodhi.lk/'),
      },
      eventDate:
        env.EVENT_DATE && Number.isFinite(Date.parse(env.EVENT_DATE)) ? env.EVENT_DATE : null,
    },
  };
}
