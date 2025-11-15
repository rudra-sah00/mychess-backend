# Chess Namespace (`/chess`)

Socket.IO namespace dedicated to real-time chess sessions.

## Connection
```ts
const socket = io("http://localhost:8080/chess", {
  path: "/socket.io/",
  auth: {
    token: "<FIREBASE_ID_TOKEN>"
  }
});
```

Server assigns a lightweight username in `socket.data.username` using the `username` query param or `guest-xxxx` fallback.

## Events

### Client → Server
| Event | Payload | Description |
| --- | --- | --- |
| `join-room` | `string` room identifier | Adds the client to `room` or defaults to `lobby`. Emits `joined-room` confirmation and notifies others via `player-joined`. |
| `move` | `{ room: string; move: string }` | Broadcasts a chess move (PGN/FEN snippet up to you) to everyone in the room. Invalid payload responses trigger `invalid-move`. |

### Server → Client
| Event | Payload | Description |
| --- | --- | --- |
| `joined-room` | `string room` | Confirmation that the client joined a room. |
| `player-joined` | `{ player: string; room: string }` | Fired to other members when someone joins the room. |
| `move` | `{ player: string; move: string; ts: number }` | Broadcasted when any player sends a `move`. `ts` is a server timestamp (ms). |
| `invalid-move` | `string error` | Sent when `move` payload is missing `room` or `move`. |
| `player-left` | `{ player: string; room: string; reason: string }` | Emitted when a socket disconnects from a room. |

## Future Extensions
- Attach Firebase UID to `socket.data` after verifying tokens in a connection middleware.
- Persist rooms/matches with Redis adapters for horizontal scaling.
- Add custom events for draw offers, resignations, and chat messages.
