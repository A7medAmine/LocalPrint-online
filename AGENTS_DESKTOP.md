# LocalPrint Desktop — Cloud Sync Agent Brief

## Goal
Add a `cloudSync.js` module (or similar) to the desktop LocalPrint app that periodically syncs with the cloud app's shop-sync API. This is the only new feature — do not change any existing UI or admin logic.

## Shared secret
Both apps share a `SHOP_API_TOKEN` (64-char hex). The desktop app should read it from its own `.env` or config file. All shop-sync requests include `Authorization: Bearer <SHOP_API_TOKEN>`.

## Cloud API contract (shop-sync endpoints)

All endpoints at `https://<cloud-domain>/api/shop/`:

### `GET /api/shop/pending`
Returns array of orders where `shopSyncStatus === 'pending'`. Each order:
```json
{
  "id": "abc123",
  "customerName": "...",
  "phoneNumber": "...",
  "notes": "...",
  "fileName": "report.pdf",
  "fileType": "application/pdf",
  "fileSize": 123456,
  "uploadDate": "2026-07-06T...",
  "status": "PENDING",
  "serverFileName": "hexfilename.pdf",
  "pageCount": 5,
  "colorMode": "color",
  "copies": 2,
  "paperType": "glossy",
  "shopSyncStatus": "pending"
}
```

### `GET /api/shop/file/:orderId`
Streams the uploaded file as a download. Use `Content-Disposition` header to get the original filename.

### `POST /api/shop/ack`
Body: `{ "orderIds": ["id1", "id2"] }`
Sets `shopSyncStatus = 'claimed'` for those orders. Shop should call this **after** downloading the file.

### `POST /api/shop/status`
Body: `{ "orderId": "abc123", "status": "PRINTED" }`
Updates the public-facing status so the customer's "my recent uploads" view reflects it. Valid statuses: `PENDING`, `READY`, `PRINTED`.

### `POST /api/shop/settings-sync`
Body:
```json
{
  "pricing": {
    "colorPerPage": 30,
    "blackWhitePerPage": 15,
    "glossyPerPage": 50,
    "cardboardPerPage": 40,
    "shopName": "My Shop",
    "phoneNumbers": ["0555123456"],
    "email": "shop@example.com",
    "address": "123 Main St",
    "workingHours": "Sat-Thu 9AM-9PM",
    "returnPolicy": "..." 
  },
  "paperTypes": [
    { "id": "normal", "name": "Normal", "nameAr": "عادي", "colorPerPage": 30, "blackWhitePerPage": 15 }
  ],
  "discountRules": [
    { "id": "rule1", "name": "10% off 50+", "discount_type": "percent", "discount_value": 10, "condition_type": "pages", "threshold": 50, "max_discount_cap": null, "priority": 1, "is_active": true }
  ]
}
```
This call overwrites the cloud app's cached data. Call it whenever the shop admin changes pricing/paper types/discount rules in the desktop app, and once at startup.

## Recommended sync flow

1. **On startup** → call `POST /api/shop/settings-sync` with current shop config.
2. **Poll every 30-60s** → `GET /api/shop/pending`.
3. **For each pending order** → `GET /api/shop/file/:orderId`, save file locally, import it into the desktop app's job queue.
4. **After successful import** → `POST /api/shop/ack` with that order's ID.
5. **When printing completes** → `POST /api/shop/status` with `status: "PRINTED"`.

## Rate limiting
The upload endpoint is rate-limited (5/min per IP), but shop-sync endpoints are not. Still, be reasonable — don't poll more than once per 15s.

## Cleanup
The cloud app auto-deletes claimed orders + their files after 7 days. No need to clean up on the desktop side.

## Implementation notes
- Store the cloud URL + SHOP_API_TOKEN in a config file or `.env`.
- Handle network failures gracefully (retry with exponential backoff).
- Log sync activity for debugging.
- Do NOT modify any existing desktop app UI or admin functionality — this is purely a background sync service.

## Config expectations
```
CLOUD_SYNC_URL=https://your-cloud-app.com
SHOP_API_TOKEN=<same 64-char hex as cloud app>
```
