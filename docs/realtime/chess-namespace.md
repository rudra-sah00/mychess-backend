# Chess Namespace (`/chess`)

Socket.IO namespace for real-time chess gameplay with server-authoritative validation.

## Connection Details

### Server URL
- **Development:** `http://localhost:8080`
- **Production:** Update with your deployed backend URL

### Namespace Path
Connect to the `/chess` namespace

### Authentication
The server requires authentication via:
- **Session Cookie**: Automatically sent with requests after logging in via `/api/auth/google`
- **Firebase ID Token**: Pass in `auth.token` if no session cookie exists

### Full Connection Example
```typescript
import { io } from "socket.io-client";

// Option 1: With session cookie (recommended)
const socket = io("http://localhost:8080/chess", {
  withCredentials: true  // Sends session cookie
});

// Option 2: With Firebase ID token
const idToken = await firebase.auth().currentUser.getIdToken();
const socket = io("http://localhost:8080/chess", {
  auth: {
    token: idToken
  }
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("Connection failed:", error.message);
});
```

## Available Events

### Room Events
| Event | Direction | Description |
| --- | --- | --- |
| `create-room` | Client → Server | Create a new room (public/private) |
| `join-room` | Client → Server | Join existing room |
| `leave-room` | Client → Server | Leave current room |
| `set-ready` | Client → Server | Toggle ready status in room |
| `list-rooms` | Client → Server | Get available public rooms |
| `get-current-room` | Client → Server | Get your current room data |
| `player-joined-room` | Server → Client | Player joined your room |
| `player-left-room` | Server → Client | Player left your room |
| `room-disbanded` | Server → Client | Room was disbanded |
| `player-ready-changed` | Server → Client | Player ready status changed |
| `game-starting` | Server → Client | Game starting from room |

### Game Events
| Event | Direction | Description |
| --- | --- | --- |
| `join-game` | Client → Server | Join existing game |
| `make-move` | Client → Server | Submit a chess move |
| `offer-draw` | Client → Server | Propose draw to opponent |
| `draw-response` | Client → Server | Accept/decline draw |
| `resign` | Client → Server | Resign the game |
| `play-with-bot` | Client → Server | Start game against AI bot |
| `move-made` | Server → Client | Broadcast validated move |
| `game-over` | Server → Client | Game ended |
| `player-reconnected` | Server → Client | Opponent reconnected |
| `clock-update` | Server → Client | Time remaining update |

### Matchmaking Events
| Event | Direction | Description |
| --- | --- | --- |
| `join-matchmaking` | Client → Server | Enter matchmaking queue |
| `leave-matchmaking` | Client → Server | Exit queue |
| `match-found` | Server → Client | Opponent found, game created |

See:
- `/docs/api/room-events.md` for room event payloads and examples
- `/docs/api/chess-events.md` for game event payloads and examples
- `/docs/guides/room-system.md` for room system guide
- `/docs/guides/bot-system.md` for bot gameplay guide
- `/docs/quickstart/room-quickstart.md` for quick start examples

## REST API Endpoints

Before connecting to Socket.IO, authenticate via REST:

### POST `/api/auth/google`
Create session cookie from Firebase ID token.

**Request**
```typescript
fetch('http://localhost:8080/api/auth/google', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    idToken: firebaseIdToken
  })
});
```

**Response**
```json
{
  "success": true,
  "uid": "firebase-uid",
  "expiresIn": 1209600000
}
```

### POST `/api/auth/refresh`
Extend session cookie.

### POST `/api/auth/logout`
Clear session and revoke tokens.

### GET `/health`
Server health check.

See `/docs/api/rest-endpoints.md` for complete REST documentation.

## CORS Configuration
Allowed origins:
- `http://localhost:5173` (Vite default)
- `http://localhost:3000` (CRA default)
