# LocalPrint Cloud

A small public-facing service for customer upload intake + order status lookup. The actual admin dashboard and printing happen in the desktop LocalPrint app, which syncs with this cloud service over a token-authenticated API.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOP_API_TOKEN
npm run dev            # Vite (port 5000) + Express (port 3001)
npm run build          # Vite build to dist/
npm start              # Production: serves dist/ + API on port 3000
```

## Architecture

- **Frontend**: React 19 + TypeScript + Vite, port 5000, Tailwind via local `tailwind.min.js`
- **Backend**: Express 5 ESM with Supabase (Postgres) instead of SQLite
- **Database**: Supabase (Postgres). Tables: `orders`, `settings`, `paper_types`, `discount_rules`
- **No auth**: Customer upload is fully public (guest). Only the shop-sync API requires a token.

## Environment variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL (Settings → API) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key (NOT the anon/public key) |
| `SHOP_API_TOKEN` | Shared secret with the desktop LocalPrint app. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | Server port (default 3001 dev / 3000 prod) |

## Shop-sync API (authenticated with SHOP_API_TOKEN)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/shop/pending` | Fetch orders not yet claimed by the shop |
| GET | `/api/shop/file/:orderId` | Download the file for a claimed order |
| POST | `/api/shop/ack` | Mark orders as claimed `{orderIds: [...]}` |
| POST | `/api/shop/status` | Push status update `{orderId, status}` |
| POST | `/api/shop/settings-sync` | Push pricing/paper types/discount rules cache |

## Public API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/upload` | Customer file upload (rate-limited) |
| POST | `/api/orders/query` | Lookup orders by ID array (for "my recent uploads") |
| DELETE | `/api/orders/:id` | Cancel an order (ownership verified) |
| GET | `/api/settings` | Shop settings (used by price calculator) |
| GET | `/api/paper-types` | Available paper types |
| GET | `/api/discount-rules/active` | Active discount rules |
| GET | `/api/files/public/:id` | Download a file by order ID |
| GET | `/api/logo` | Shop logo |

## Cleanup

Claimed orders older than 7 days are automatically deleted (files + DB rows) once daily.

## Tech stack

- Express 5 + Multer for uploads
- `pdf-lib` for page count detection
- Supabase (`@supabase/supabase-js`) for database
- React 19 + TypeScript + Vite
- Tailwind CSS (local `tailwind.min.js`)
