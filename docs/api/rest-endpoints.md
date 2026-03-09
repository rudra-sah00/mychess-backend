# REST API Endpoints

HTTP endpoints for authentication and server health.

## Base URL
- **Local:** `http://localhost:8080`
- **Production:** `https://api.mychess.com`

## Authentication

### POST `/api/auth/register`
Register a new account.
- Body: `{ username, password }`

### POST `/api/auth/login`
Login and set session cookie.
- Body: `{ username, password }`

### POST `/api/auth/logout`
Logout and clear session cookie.

### GET `/api/auth/status`
Check authentication status.

## System

### GET `/health`
Check server health. Returns:
```json
{
  "status": "ok",
  "timestamp": 1731700000000
}
```

## Security
- All requests require `withCredentials: true` in standard browser environments to send/receive cookies.
- Errors are returned in the format: `{ error: 'description' }`.
