# MyChess Backend

Node.js + TypeScript Socket.IO backend scaffold for real-time chess interactions.

## Requirements
- Node.js 20+
- npm 10+

## Setup
```sh
npm install
```

Create a `.env` based on `.env.example` if you need custom ports or socket paths.

## Development
```sh
npm run dev
```

This runs `ts-node-dev` with live reload and starts the Socket.IO namespace at `/chess` (path customizable via env).

## Production build
```sh
npm run build
NODE_ENV=production npm start
```

## Logging
The backend uses Winston for structured logging:
- **Development:** Colorized console output with debug level
- **Production:** JSON logs to `logs/combined.log` and `logs/error.log` with automatic rotation (5MB max, 5 files)

Log levels: error, warn, info, debug

## Production features
- **Helmet:** Security headers
- **Compression:** Gzip response compression
- **Rate limiting:** 100 requests per 15 minutes per IP
- **Session cookies:** HTTP-only, secure, 14-day expiry
- **File logging:** Automatic rotation and retention

## Testing & linting
```sh
npm test
npm run lint
```

## Project structure
```
src/
	app.ts            Express + Socket.IO wiring
	server.ts         Process entrypoint
	config/           Environment helpers
	modules/chess/    Chess-specific gateways and logic
docs/
	api/              REST endpoint references
	realtime/         Socket.IO namespace docs
```

Extend `modules/chess` with matchmaking, move validation, and persistence layers as the project evolves.

## Documentation
- REST: `docs/api/auth.md` - Authentication endpoints (sign-in, refresh, logout, status)
- Socket.IO: `docs/realtime/chess-namespace.md`

Add new endpoints/namespaces by mirroring these formats to keep the documentation source-controlled and reviewable.
