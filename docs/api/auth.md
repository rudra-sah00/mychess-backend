# Authentication Endpoints

Custom JWT-based authentication using cookies and JSON responses.

## POST /api/auth/register

Create a new user account.

### Request
- **Method:** `POST`
- **Path:** `/api/auth/register`
- **Body:**
  ```json
  {
    "username": "player123",
    "password": "securepassword"
  }
  ```

### Response (201 Created)
```json
{
  "success": true,
  "user": {
    "id": "uuid-123",
    "username": "player123",
    "rating": 1200
  }
}
```

---

## POST /api/auth/login

Sign in and receive a session cookie.

### Request
- **Method:** `POST`
- **Path:** `/api/auth/login`
- **Body:**
  ```json
  {
    "username": "player123",
    "password": "securepassword"
  }
  ```

### Response (200 OK)
```json
{
  "success": true,
  "user": {
    "id": "uuid-123",
    "username": "player123",
    "rating": 1200
  }
}
```
Sets `session` HTTP-only cookie.

---

## POST /api/auth/logout

Clear session cookie.

### Request
- **Method:** `POST`
- **Path:** `/api/auth/logout`

### Response (200 OK)
```json
{
  "success": true
}
```

---

## GET /api/auth/status

Check if the current session is valid.

### Request
- **Method:** `GET`
- **Path:** `/api/auth/status`

### Response (200 OK)
```json
{
  "authenticated": true,
  "user": {
    "id": "uuid-123",
    "username": "player123"
  }
}
```

---

## Notes
- Cookies are `httpOnly`, `secure` (in production), and `sameSite: lax`.
- The JWT is stored within the `session` cookie.
- Rate limiting is applied to all auth endpoints.
