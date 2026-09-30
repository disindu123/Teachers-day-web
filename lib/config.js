import 'dotenv/config';

export function loadConfig(env = process.env) {
  let automatic = {};
  try {
    automatic = JSON.parse(env.FIREBASE_CONFIG || '{}');
  } catch {
    /* Optional platform config. */
  }
  const projectId = env.FB_PROJECT_ID || automatic.projectId || env.GCLOUD_PROJECT || '';
  const bucket = env.FB_STORAGE_BUCKET || automatic.storageBucket || '';
  const firebase = {
    apiKey: env.FB_WEB_API_KEY || '',
    authDomain: env.FB_WEB_AUTH_DOMAIN || '',
    projectId,
    storageBucket: bucket,
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
  return {
    env,
    projectId,
    bucket,
    firebase,
    configured,
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === '1' ? 1 : false,
    publicSiteUrl: env.PUBLIC_SITE_URL || '',
    rateLimitSalt: env.RATE_LIMIT_SALT || '',
    public: {
      firebase: configured ? firebase : null,
      configured,
      social: {
        facebook: validLink(env.SOCIAL_FACEBOOK),
        tiktok: validLink(env.SOCIAL_TIKTOK),
        instagram: validLink(env.SOCIAL_INSTAGRAM),
        website: validLink(env.SCHOOL_WEBSITE || 'https://srisanghabodhi.lk/'),
      },
      eventDate:
        env.EVENT_DATE && Number.isFinite(Date.parse(env.EVENT_DATE)) ? env.EVENT_DATE : null,
    },
  };
}
