const requiredFrontend = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY'
];

const requiredBackend = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_BASE_URL',
  'WEB_ORIGIN'
];

const missing = [];
for (const key of requiredFrontend.concat(requiredBackend)) {
  if (!process.env[key]) missing.push(key);
}

if (missing.length) {
  console.error('Missing env vars for deploy:\n' + missing.map(k => `- ${k}`).join('\n'));
  process.exit(1);
}

if (!process.env.VITE_API_BASE_URL && !process.env.VITE_API_URL) {
  console.warn('VITE_API_BASE_URL/VITE_API_URL not set; frontend API calls will use same-origin /api routes.');
}

console.log('Deploy env check passed.');
