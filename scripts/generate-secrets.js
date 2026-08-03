import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
}

const generateSecret = () => crypto.randomBytes(32).toString('hex');

const secretsNeeded = ['JWT_SECRET', 'SA_JWT_SECRET', 'SESSION_SECRET'];
let updated = false;

for (const key of secretsNeeded) {
  if (!envContent.includes(`${key}=`)) {
    const val = generateSecret();
    envContent += `\n${key}=${val}`;
    console.log(`[Secrets] Generated new ${key}`);
    updated = true;
  } else {
    console.log(`[Secrets] ${key} already configured in .env`);
  }
}

if (updated) {
  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('[Secrets] Updated .env file successfully.');
} else {
  console.log('[Secrets] All secrets are already present in .env.');
}
