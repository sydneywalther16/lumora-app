import { loadEnv } from 'vite';

const mode = process.argv[2] || 'production';
const env = loadEnv(mode, process.cwd(), '');
const requiredClientConfig = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];
const missing = requiredClientConfig.filter((name) => !env[name]);

if (missing.length > 0) {
  console.error(`Client account configuration is unavailable for this ${mode} build: ${missing.join(', ')}`);
  process.exit(1);
}

console.info(`Client account configuration is available for this ${mode} build.`);
