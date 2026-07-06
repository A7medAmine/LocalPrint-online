# PrintShop Hub

A professional print shop management system with Arabic/English bilingual support.

## Architecture

- **Frontend**: React 19 + TypeScript + Vite (port 5000)
- **Backend**: Express.js API server (port 3001 in dev, port 3000 in production)
- **Database**: SQLite via better-sqlite3 (`database.sqlite`)
- **Styling**: Tailwind CSS (local `tailwind.min.js`)

## Project Structure

```
/
├── App.tsx              # Main React application
├── index.tsx            # React entry point
├── index.html           # HTML template
├── server.js            # Express backend API
├── db.js                # SQLite database setup and helpers
├── database.sqlite      # SQLite database file
├── vite.config.ts       # Vite config (frontend: port 5000, proxy /api → port 3001)
├── components/          # React components
├── services/            # Frontend service layer
├── utils/               # Utility functions
├── views/               # View components
├── public/              # Static assets
└── uploads/             # Uploaded files (auto-created)
```

## Development

Run both frontend and backend concurrently:
```bash
npm run dev
```

- Frontend: http://localhost:5000
- Backend API: http://localhost:3001/api

## Production

Build and run the production server (serves static dist + API on port 3000):
```bash
npm run build
npm start
```

## Key Features

- Document upload for printing (PDF and other formats)
- Customer job tracking with status management
- Arabic/English bilingual interface (RTL/LTR support)
- Discount rules engine
- QR code generation for jobs
- PDF page count detection
- Print settings (color/B&W, copies)
- Admin settings panel

## Database Schema

- `jobs` — print jobs with customer info, file details, status
- `settings` — key-value store for app configuration
- `discount_rules` — configurable discount rules by page/copy thresholds

## Deployment

- **Target**: autoscale
- **Build**: `npm run build`
- **Run**: `node server.js` (serves built frontend + API on port 3000)
