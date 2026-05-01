const requiredFrontend = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_API_URL'
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

console.log('Deploy env check passed.');
