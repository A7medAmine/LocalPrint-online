# PrintShop Hub - Project Structure

## Overview

PrintShop Hub is a full-stack React application with Express backend for document printing services. The project has been converted from ESM CDN imports to a local development setup using Vite and npm.

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Available Scripts

#### Development

```bash
npm run dev          # Start both frontend (Vite) and backend (Express) concurrently
npm run frontend     # Start only frontend development server (port 5173)
npm run backend      # Start only backend server (port 3001)
```

#### Production

```bash
npm run build        # Build React application for production
npm run start        # Start production server (serves built React app + API)
npm run preview      # Preview production build locally
```

## Project Structure

```
printshop-hub/
├── public/                 # Static assets
├── src/                    # React application source (recommended structure)
│   ├── components/         # Reusable React components
│   │   └── LanguageToggle.tsx
│   ├── views/              # Page-level components
│   │   ├── UploadView.tsx
│   │   └── AdminView.tsx
│   ├── services/           # API and business logic services
│   │   └── storageService.ts
│   ├── types.ts            # TypeScript type definitions
│   ├── constants.tsx       # Application constants and translations
│   ├── App.tsx             # Main React application component
│   ├── index.tsx           # React application entry point
│   └── index.css           # Global styles
├── uploads/                # File upload directory (auto-created)
├── dist/                   # Production build output (auto-created)
├── components/             # Current component location (consider moving to src/)
├── views/                  # Current view location (consider moving to src/)
├── services/               # Current services location (consider moving to src/)
├── server.js               # Express backend server
├── index.html              # HTML template for React app
├── package.json            # Dependencies and scripts
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
├── .env                    # Environment variables
├── .gitignore              # Git ignore rules
└── db.json                 # JSON database file
```

## Key Configuration Files

### package.json

- **Dependencies**: React, React DOM, Express, Multer
- **Dev Dependencies**: TypeScript, Vite, React plugin, type definitions
- **Scripts**: Development, build, and production commands

### vite.config.ts

- **Frontend Port**: 5173 (development)
- **Backend Proxy**: API requests proxied to localhost:3001
- **Build Output**: dist/ directory
- **Path Alias**: @/ maps to src/ (when using src structure)

### server.js

- **Backend Port**: 3001 (development), 3000 (production)
- **CORS**: Configured for localhost:5173 in development
- **File Uploads**: Handled via Multer to uploads/ directory
- **Database**: JSON file-based persistence (db.json)

## Development Workflow

1. **Start Development**: `npm run dev`
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - Hot reload enabled for React components

2. **File Organization** (Recommended):
   - Move React files to `src/` directory for better organization
   - Use `@/` alias for cleaner imports (e.g., `import Component from '@/components/Component'`)

3. **API Communication**:
   - Frontend makes requests to `/api/*` endpoints
   - Vite proxy forwards these to backend server
   - No CORS issues in development

## Environment Variables

Create `.env` file in root directory:

```
NODE_ENV=development
PORT=3001
```

## Production Deployment

1. Build application: `npm run build`
2. Start production server: `npm run start`
3. Application serves both React frontend and API from same port

## Import Changes Made

All CDN imports have been replaced with local npm packages:

- ✅ `react` → Local npm package
- ✅ `react-dom` → Local npm package
- ✅ `express` → Local npm package
- ✅ `multer` → Local npm package
- ✅ `path`, `fs`, `url` → Node.js built-in modules

The project now works completely offline with local development setup.
