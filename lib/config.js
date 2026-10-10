import 'dotenv/config';

export function loadConfig(env = process.env) {
  let automatic = {};
  try {
    automatic = JSON.parse(env.FIREBASE_CONFIG || '{}');
  } catch {
    /* optional platform config */
  }
  const projectId = env.FB_PROJECT_ID || automatic.projectId || env.GCLOUD_PROJECT || '';
  const bucket = env.FB_STORAGE_BUCKET || automatic.storageBucket || '';
  const firebase = {
    apiKey: env.FB_WEB_API_KEY || '',
    authDomain: env.FB_WEB_AUTH_DOMAIN || '',
    projectId,
    appId: env.FB_WEB_APP_ID || '',
    storageBucket: bucket,
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
  const configured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(
    (key) => firebase[key] && !/^(your-|replace-)/.test(firebase[key]),
  );
  const eventInput = env.EVENT_DATE || '2026-10-06T08:00:00+05:30';
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventInput)
    ? `${eventInput}T08:00:00+05:30`
    : eventInput;
  return {
    env,
    firebase,
    projectId,
    bucket,
    configured,
    production: env.NODE_ENV === 'production',
    // Trust only the deployment's known proxy hops; never use true here.
    trustProxy: /^\d+$/.test(env.TRUST_PROXY || '') ? Number(env.TRUST_PROXY) : false,
    publicSiteUrl: env.PUBLIC_SITE_URL || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rateLimitSalt: env.RATE_LIMIT_SALT || '',
    public: {
      firebase: configured ? firebase : null,
      configured,
      uploadsConfigured: !!bucket && !/^(your-|replace-)/.test(bucket),
      siteName: 'සඟබෝ පැහැසර',
      email: 'sangabopahasara@gmail.com',
      logoUrl: validLink(env.LOGO_URL) || '/assets/scmu-logo.svg',
      social: {
        facebook: validLink(env.SOCIAL_FACEBOOK),
        tiktok: validLink(env.SOCIAL_TIKTOK),
        instagram: validLink(env.SOCIAL_INSTAGRAM),
        youtube: validLink(env.SOCIAL_YOUTUBE || 'https://www.youtube.com/@SanghaboPahasara'),
        website: validLink(env.SCHOOL_WEBSITE || 'https://srisanghabodhi.lk/'),
      },
      eventDate: Number.isFinite(Date.parse(eventDate)) ? eventDate : null,
    },
  };
}
