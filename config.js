import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Support ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    publicKey: process.env.DISCORD_PUBLIC_KEY,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
};

// Simple sanity checks
export function validateConfig() {
  const missing = [];
  if (!config.discord.token) missing.push('DISCORD_TOKEN');
  if (!config.discord.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey || config.supabase.serviceRoleKey === 'YOUR_SUPABASE_SERVICE_ROLE_KEY') {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  if (missing.length > 0) {
    console.error(`\n❌ CONFIGURATION ERROR: Missing required fields in .env:\n- ${missing.join('\n- ')}\n`);
    return false;
  }
  return true;
}
