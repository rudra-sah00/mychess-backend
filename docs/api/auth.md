# Authentication Endpoints

Session-based authentication using Firebase ID tokens and session cookies (14-day expiry).

## POST /api/auth/google

Sign in with a Firebase ID token and receive a session cookie.

### Request
- **Method:** `POST`
- **Path:** `/api/auth/google`
- **Headers:**
  - `Authorization: Bearer <idToken>` (optional)
  - `Content-Type: application/json`
- **Body:**
  ```json
  {
    "idToken": "<FIREBASE_ID_TOKEN>"
  }
  ```

### Response (200 OK)
```json
{
  "success": true,
  "uid": "abc123",
  "expiresIn": 1209600000
}
```

Sets `session` HTTP-only cookie valid for 14 days.

### Errors
- **400:** Missing `idToken`
- **401:** Invalid or expired token

---

## POST /api/auth/refresh

Extend the current session cookie expiry by another 14 days.

### Request
- **Method:** `POST`
- **Path:** `/api/auth/refresh`
- **Cookies:** `session` (required)

### Response (200 OK)
```json
{
  "success": true,
  "uid": "abc123",
  "expiresIn": 1209600000
}
```

Replaces the existing `session` cookie with a refreshed one.

### Errors
- **401:** No session found or session invalid (cookie cleared automatically)

---

## POST /api/auth/logout

Clear session cookie and revoke all refresh tokens for the user.

### Request
- **Method:** `POST`
- **Path:** `/api/auth/logout`
- **Cookies:** `session` (optional)

### Response (200 OK)
```json
{
  "success": true
}
```

Clears the `session` cookie regardless of validity.

---

## GET /api/auth/status

Check if the current session is valid and retrieve user info.

### Request
- **Method:** `GET`
- **Path:** `/api/auth/status`
- **Cookies:** `session` (optional)

### Response (200 OK)
When authenticated:
```json
{
  "authenticated": true,
  "uid": "abc123",
  "email": "user@example.com",
  "expiresAt": 1731703650000
}
```

When not authenticated:
```json
{
  "authenticated": false
}
```

---

## Notes
- Session cookies are HTTP-only, secure in production, and use `sameSite: lax`.
- Maximum session duration is 14 days (Firebase Admin SDK limit).
- On logout, all user refresh tokens are revoked to invalidate other sessions.
- Frontend should handle 401 responses by clearing local state and redirecting to login.
