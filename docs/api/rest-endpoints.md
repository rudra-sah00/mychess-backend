# REST API Endpoints

HTTP endpoints for authentication and server status.

## Base URL
- **Development:** `http://localhost:8080`
- **Production:** Your deployed URL

## Authentication Endpoints

### POST `/api/auth/google`
Create a session cookie from a Firebase ID token.

**Request**
```http
POST /api/auth/google
Content-Type: application/json

{
  "idToken": "firebase-id-token-here"
}
```

**Alternative: Bearer Token**
```http
POST /api/auth/google
Authorization: Bearer firebase-id-token-here
```

**Response (Success)**
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "expiresIn": 1209600000
}
```

**Response (Error)**
```json
{
  "error": "invalid token"
}
```

**Session Cookie**
- Name: `session`
- Duration: 14 days
- HTTPOnly: true
- Secure: true (production only)
- SameSite: lax

---

### POST `/api/auth/refresh`
Extend an existing session cookie.

**Request**
```http
POST /api/auth/refresh
Cookie: session=existing-session-cookie
```

**Response (Success)**
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "expiresIn": 1209600000
}
```

**Response (Error - No Session)**
```json
{
  "error": "no session found"
}
```

**Response (Error - Invalid Session)**
```json
{
  "error": "invalid session"
}
```

---

### POST `/api/auth/logout`
Clear session cookie and revoke Firebase refresh tokens.

**Request**
```http
POST /api/auth/logout
Cookie: session=existing-session-cookie
```

**Response**
```json
{
  "success": true
}
```

**Note:** Session cookie is cleared regardless of success/failure.

---

### GET `/api/auth/verify`
Verify current session is valid.

**Request**
```http
GET /api/auth/verify
Cookie: session=existing-session-cookie
```

**Response (Success)**
```json
{
  "authenticated": true,
  "uid": "firebase-user-id"
}
```

**Response (Unauthenticated)**
```json
{
  "authenticated": false
}
```

---

## Health Check

### GET `/health`
Server health status.

**Request**
```http
GET /health
```

**Response**
```json
{
  "status": "ok",
  "timestamp": 1731700000000
}
```

---

## Rate Limiting

All `/api/` endpoints are rate-limited:
- **Development:** 1000 requests per 15 minutes per IP
- **Production:** 100 requests per 15 minutes per IP

**Rate Limit Response**
```http
HTTP/1.1 429 Too Many Requests
Content-Type: text/html

Too many requests from this IP
```

---

## CORS Configuration

Allowed origins:
- `http://localhost:5173` (Vite)
- `http://localhost:3000` (Create React App)

Credentials: Enabled (required for cookies)

---

## Error Responses

All endpoints return consistent error structures:

```json
{
  "error": "error-message-here"
}
```

**Common HTTP Status Codes**
- `200`: Success
- `400`: Bad Request (missing/invalid parameters)
- `401`: Unauthorized (invalid/expired token)
- `429`: Too Many Requests (rate limited)
- `500`: Internal Server Error

---

## Client Integration Example

### TypeScript/JavaScript
```typescript
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Sign in with Google
const provider = new GoogleAuthProvider();
const result = await signInWithPopup(auth, provider);
const idToken = await result.user.getIdToken();

// Create session
const response = await fetch('http://localhost:8080/api/auth/google', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // Important: send/receive cookies
  body: JSON.stringify({ idToken })
});

const data = await response.json();
if (data.success) {
  console.log('Logged in:', data.uid);
  
  // Now connect to Socket.IO (session cookie sent automatically)
  const socket = io('http://localhost:8080/chess', {
    withCredentials: true
  });
}
```

### React Hook Example
```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export function useChessSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Verify session before connecting
    fetch('http://localhost:8080/api/auth/verify', {
      credentials: 'include'
    })
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          const newSocket = io('http://localhost:8080/chess', {
            withCredentials: true
          });
          setSocket(newSocket);
        }
      });

    return () => {
      socket?.disconnect();
    };
  }, []);

  return socket;
}
```

---

## Security Best Practices

1. **Always use HTTPS in production**
2. **Never expose ID tokens in URLs or logs**
3. **Set `withCredentials: true` for all requests**
4. **Verify session on page load**
5. **Handle 401 responses by redirecting to login**
6. **Refresh session periodically (every 7 days)**
7. **Call `/api/auth/logout` on user logout**
