# Chess API Events Reference

Complete Socket.IO event documentation for chess gameplay.

## Authentication

All socket connections must authenticate before emitting game events.

### Connection
```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8080/chess', {
  path: '/socket.io/',
  auth: {
    token: firebaseIdToken  // Or session cookie will be sent automatically
  }
});
```

## Game Events

### `join-game`
Join an existing game or reconnect.

**Client → Server**
```typescript
socket.emit('join-game', { gameId: 'abc123' }, (response) => {
  if (response.success) {
    // Joined successfully, access response.gameState
  } else {
    console.error(response.error);
  }
});
```

**Response**
```typescript
{
  success: true,
  gameState: {
    gameId: 'abc123',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    turn: 'w',
    status: 'active',
    winner: null,
    endReason: null,
    whitePlayer: { uid: string, socketId: string },
    blackPlayer: { uid: string, socketId: string },
    clockState: { whiteTimeMs: number, blackTimeMs: number, activeColor: 'w'|'b'|null },
    drawOffer: { from: 'white'|'black', pending: boolean } | undefined
  }
}
```

---

### `make-move`
Submit a move for validation.

**Client → Server**
```typescript
socket.emit('make-move', {
  gameId: 'abc123',
  from: 'e2',
  to: 'e4',
  promotion?: 'q' | 'r' | 'b' | 'n'
}, (response) => {
  if (response.success) {
    // Move accepted
  } else {
    console.error(response.error); // 'ILLEGAL_MOVE', 'NOT_YOUR_TURN', etc.
  }
});
```

**Response (Success)**
```typescript
{
  success: true,
  moveNumber: 1,
  san: 'e4',
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  turn: 'black'
}
```

**Response (Failure)**
```typescript
{
  success: false,
  error: 'ILLEGAL_MOVE' | 'NOT_YOUR_TURN' | 'GAME_OVER' | 'TIMEOUT' | 'STALE_STATE'
}
```

---

### `move-made`
Broadcasted to all participants when a move is accepted.

**Server → Clients**
```typescript
socket.on('move-made', (data) => {
  // Update board with new move
  console.log(data);
});
```

**Payload**
```typescript
{
  from: 'e2',
  to: 'e4',
  promotion?: 'q',
  san: 'e4',
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  turn: 'b',
  clockState: {
    whiteTimeMs: 298000,
    blackTimeMs: 300000,
    activeColor: 'b',
    lastUpdateTimestamp: 1731700000000
  }
}
```

---

### `clock-update`
Server broadcasts clock state every second during active games.

**Server → Clients**
```typescript
socket.on('clock-update', (data) => {
  // Update clock display
});
```

**Payload**
```typescript
{
  gameId: 'abc123',
  clocks: {
    white: { remaining: 295000 },
    black: { remaining: 298000 }
  },
  turn: 'black'
}
```

---

### `offer-draw`
Propose a draw to opponent.

**Client → Server**
```typescript
socket.emit('offer-draw', { gameId: 'abc123' }, (response) => {
  if (response.success) {
    // Draw offer sent
  }
});
```

**Server → Opponent**
```typescript
socket.on('draw-offered', ({ gameId, fromPlayer }) => {
  // Show draw offer UI
});
```

---

### `respond-draw`
Accept or decline a draw offer.

**Client → Server**
```typescript
socket.emit('respond-draw', {
  gameId: 'abc123',
  accept: true | false
}, (response) => {
  // Response processed
});
```

If accepted, server broadcasts `game-over` with result `draw`.

---

### `resign`
Resign the game immediately.

**Client → Server**
```typescript
socket.emit('resign', { gameId: 'abc123' }, (response) => {
  if (response.success) {
    // Game ended
  }
});
```

Server broadcasts `game-over` with `endReason: 'resignation'`.

---

### `game-over`
Broadcasted when game ends for any reason.

**Server → Clients**
```typescript
socket.on('game-over', (data) => {
  // Display result, update UI
});
```

**Payload**
```typescript
{
  gameId: 'abc123',
  result: 'white' | 'black' | 'draw',
  endReason: 'checkmate' | 'resignation' | 'timeout' | 'draw-agreement' | 'stalemate' | 'insufficient-material' | 'threefold-repetition' | '50-move-rule',
  winner: 'uid' | null,
  ratingChanges: {
    white: { old: 1520, new: 1528, delta: +8 },
    black: { old: 1505, new: 1497, delta: -8 }
  },
  finalFen: 'final-position',
  timestamp: 1731700000000
}
```

---

### `game-state`
Sent on reconnection or explicit request for full game snapshot.

**Server → Client**
```typescript
socket.on('game-state', (data) => {
  // Restore full game state
});
```

**Payload**
```typescript
{
  gameId: 'abc123',
  fen: 'current-fen',
  pgn: '1. e4 e5 2. Nf3',
  players: { white: {...}, black: {...} },
  clocks: { white: {...}, black: {...} },
  turn: 'white',
  status: 'active',
  moves: [
    { moveNumber: 1, san: 'e4', fen: '...', timestamp: ... },
    { moveNumber: 2, san: 'e5', fen: '...', timestamp: ... }
  ],
  lastMoveAt: 1731700000000,
  drawOffered: false
}
```

---

### `player-disconnected`
Notify opponent when player loses connection.

**Server → Clients**
```typescript
socket.on('player-disconnected', ({ gameId, color, uid }) => {
  // Show disconnection warning
});
```

---

### `player-reconnected`
Notify opponent when player returns.

**Server → Clients**
```typescript
socket.on('player-reconnected', ({ gameId, color, uid }) => {
  // Hide disconnection warning
});
```

---

## Matchmaking Events

### `join-matchmaking`
Enter matchmaking queue.

**Client → Server**
```typescript
socket.emit('join-matchmaking', {
  rating?: 1500,
  timeControl?: {
    initialTimeMs: 300000,
    incrementMs: 3000
  }
}, (response) => {
  if (response.success) {
    console.log('Queue size:', response.queueSize);
    console.log('Position:', response.position);
  }
});
```

---

### `leave-matchmaking`
Exit matchmaking queue.

**Client → Server**
```typescript
socket.emit('leave-matchmaking', (response) => {
  if (response.success) {
    // Successfully left queue
  }
});
```

---

### `match-found`
Server found an opponent, game starting.

**Server → Client**
```typescript
socket.on('match-found', (data) => {
  // Navigate to game
});
```

**Payload**
```typescript
{
  gameId: 'abc123',
  color: 'white' | 'black',
  opponent: {
    uid: 'opponent-uid',
    socketId: 'socket-id'
  }
}
```

---

## Error Handling

All events use standard error responses:

```typescript
{
  success: false,
  error: 'ERROR_CODE',
  message: 'Human-readable description'
}
```

**Common Error Codes**
- `UNAUTHORIZED`: Not authenticated
- `NOT_IN_GAME`: Player not part of this game
- `GAME_NOT_FOUND`: Invalid gameId
- `ILLEGAL_MOVE`: Move violates chess rules
- `NOT_YOUR_TURN`: Wrong player attempting move
- `GAME_OVER`: Game already ended
- `RATE_LIMIT`: Too many requests
- `INVALID_PAYLOAD`: Malformed request data

---

## Rate Limits

Per user/per event:
- `make-move`: 1/sec
- `offer-draw`: 1/30sec per game
- `chat`: 5/10sec
- `join-queue`: 1/5sec

Exceeding limits returns `RATE_LIMIT` error.

---

## Best Practices

1. **Always use acknowledgment callbacks** for move submissions to handle rejections gracefully
2. **Store socket.id** for debugging and support requests
3. **Handle reconnections** by listening for `game-state` events
4. **Display clock-update** every second for smooth countdown UX
5. **Show opponent disconnect warnings** after 5 seconds of `player-disconnected`
6. **Validate moves client-side** with chess.js before emitting to reduce rejections
7. **Log all error responses** for analytics and debugging
