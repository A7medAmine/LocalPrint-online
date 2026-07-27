// One-off admin provisioning script.
// Usage: node scripts/create-shop.js "Shop Name" [--host https://cloud.example.com]
//
// Creates a shop row (with a fresh API token) and prints everything the shop
// owner needs: the token + Cloud URL to paste into their local app's
// Admin -> Cloud Sync settings, and the public upload link/QR target.
import 'dotenv/config';
import { createShop } from '../db.js';

const args = process.argv.slice(2);
const hostFlagIndex = args.indexOf('--host');
const host = hostFlagIndex !== -1 ? args[hostFlagIndex + 1] : (process.env.PUBLIC_URL || null);
const name = args.filter((a, i) => a !== '--host' && i !== hostFlagIndex + 1)[0];

if (!name) {
  console.error('Usage: node scripts/create-shop.js "Shop Name" [--host https://cloud.example.com]');
  process.exit(1);
}

const shop = await createShop(name);

console.log('\n✅ Shop created\n');
console.log(`  Name:  ${shop.name}`);
console.log(`  Slug:  ${shop.slug}`);
console.log(`  Token: ${shop.token}`);
console.log('\n⚠️  This token is shown once — store it now.\n');

console.log('Paste into the shop\'s LocalPrint Admin -> Cloud Sync settings:');
console.log(`  Cloud URL:  ${host || '<your cloud host, e.g. https://cloud.example.com>'}`);
console.log(`  API Token:  ${shop.token}`);

console.log('\nPublic upload link (share as-is or encode into a QR code):');
console.log(`  ${host ? `${host.replace(/\/+$/, '')}/s/${shop.slug}/upload` : `https://<your-cloud-host>/s/${shop.slug}/upload`}`);
console.log('');

process.exit(0);
