# Chess Backend Architecture

Production-grade server-authoritative chess engine design.

## Core Responsibilities

### 1. Authentication & Authorization
- **Socket Authentication:** Every socket connection must be authenticated via session cookie or Firebase ID token
- **UID Attachment:** After verification, attach `uid` to `socket.data` for all subsequent operations
- **Role-Based Access:** Distinguish between players (can move) and spectators (read-only)
- **Anti-Spoofing:** Never trust client-reported color/turn; derive from server state

### 2. Server-Authoritative Move Validation
- **chess.js Integration:** All moves validated through chess.js engine
- **Legal Move Check:** Verify move is legal in current position
- **Turn Verification:** Ensure moving player owns the current turn
- **Piece Ownership:** Confirm player can only move their own pieces
- **State Consistency:** Reject moves referencing stale game state

### 3. Atomic State Updates
All game mutations must be atomic:
```
1. Lock game state (Redis lock or DB transaction)
2. Validate move
3. Apply move to chess.js instance
4. Generate new FEN
5. Persist move to database
6. Update game state
7. Release lock
8. Broadcast to clients
```

### 4. Server-Controlled Clocks
- **Authoritative Time:** Server owns all clock state
- **Tick Management:** Server emits clock updates, never trusts client timestamps
- **Automatic Switching:** Clock switches on valid move submission
- **Timeout Detection:** Server detects flag falls and ends game
- **Increment/Delay:** Apply time bonuses per time control rules

### 5. Move Persistence
Every move must be stored with:
- `moveNumber`: Ply count
- `uid`: Player who made the move
- `san`: Standard Algebraic Notation (e.g., "Nf3")
- `uci`: Universal Chess Interface (e.g., "g1f3")
- `fen`: Board state after move
- `timestamp`: Server time when move accepted
- `timeRemaining`: Player's clock after move
- `thinkTime`: Time spent on this move

### 6. Broadcasting
After accepting a move:
```typescript
io.to(gameId).emit('move-made', {
  gameId,
  moveNumber,
  san: 'e4',
  fen: 'new-fen-string',
  turn: 'black',
  clocks: {
    white: { remaining: 298000, increment: 2000 },
    black: { remaining: 295000, increment: 2000 }
  },
  timestamp: Date.now()
});
```

### 7. Acknowledgments & Rejections
Use Socket.IO callbacks for synchronous validation feedback:
```typescript
socket.emit('make-move', { gameId, move: 'e4' }, (response) => {
  if (response.success) {
    // Move accepted
  } else {
    // Display response.error
  }
});
```

Rejection reasons:
- `ILLEGAL_MOVE`: Not legal per chess rules
- `NOT_YOUR_TURN`: Opponent's turn
- `GAME_OVER`: Game already ended
- `NOT_IN_GAME`: Player not part of this game
- `TIMEOUT`: Player's clock expired
- `STALE_STATE`: Move based on outdated position

### 8. Reconnection & Resync
When player reconnects:
1. Authenticate uid
2. Query active games for this user
3. Load full game state from database
4. Send complete snapshot:
```typescript
socket.emit('game-state', {
  gameId,
  fen,
  pgn,
  moves: [...], // All moves
  players: { white: {...}, black: {...} },
  clocks: { white: {...}, black: {...} },
  turn,
  status,
  lastMoveAt
});
```

### 9. Game Termination
Server detects and enforces all game-ending conditions:
- **Checkmate:** chess.js reports mate
- **Stalemate:** chess.js reports stalemate
- **Draw by Agreement:** Both players accept draw offer
- **Threefold Repetition:** Detected via position history
- **50-Move Rule:** No pawn move or capture in 50 moves
- **Insufficient Material:** K vs K, KN vs K, KB vs K, etc.
- **Timeout:** Clock expires
- **Resignation:** Player resigns
- **Abandonment:** Player disconnects >60s in active game

On termination:
1. Update game status and result in database
2. Calculate rating changes (Elo/Glicko)
3. Update player stats
4. Broadcast `game-over` event
5. Clean up active game references

### 10. Anti-Cheat & Analytics
- **Move Timing:** Store think time for every move
- **Engine Correlation:** Asynchronously compare moves to Stockfish top lines
- **Blur Detection:** Track tab visibility events
- **Flagging System:** Auto-review accounts with >90% engine correlation
- **Audit Trail:** Log all move submissions, rejections, disconnects

### 11. Matchmaking
- **Queue Management:** Store players in Firebase by time control and rating
- **Rating Ranges:** ±100 ELO initially, expand every 10s
- **Fair Pairing:** Balance colors, avoid recent opponents
- **Timeout:** Remove from queue after 5 minutes
- **Cancel Support:** Allow players to leave queue

### 12. Rate Limiting
Protect socket endpoints:
- **make-move:** Max 1 per second per user
- **chat:** Max 5 per 10 seconds per user
- **draw-offer:** Max 1 per 30 seconds per game
- **Connection:** Max 3 reconnects per minute per IP

### 13. Logging & Observability
Log all critical events:
- Move acceptances and rejections
- Game starts and completions
- Clock expirations
- Disconnections and reconnections
- Rating updates
- Suspicious activity flags

## Architecture Components

### Services
- `ChessEngine`: Wraps chess.js, validates moves, generates FEN/PGN
- `GameManager`: Manages active games, state persistence
- `ClockService`: Handles countdowns, timeouts, increments
- `MatchmakingService`: Queue management, pairing logic
- `RatingService`: Elo calculations, stat updates
- `AntiCheatService`: Async move analysis

### Middleware
- `socketAuth`: Verify session/token, attach uid
- `gameAuth`: Verify player is part of requested game
- `rateLimiter`: Per-user/per-event rate limits

### Event Handlers
- `make-move`: Validate, apply, persist, broadcast move
- `offer-draw`: Propose draw to opponent
- `accept-draw` / `decline-draw`: Handle draw responses
- `resign`: End game immediately
- `request-rematch`: Propose new game
- `reconnect`: Full state resync

## Time Controls

### Bullet
- 1+0 (1 minute, no increment)
- 2+1 (2 minutes, 1 second increment)

### Blitz
- 3+0, 3+2, 5+0, 5+3

### Rapid
- 10+0, 15+10, 30+0

### Classical
- 30+20, 60+0

### Custom
- Support any base time + increment/delay combination

## Variants Support

### Standard Chess
- Full FIDE rules
- Castling, en passant, promotion

### Chess960 (Fischer Random)
- Random back-rank setup
- Modified castling rules
- Store starting FEN in game metadata

## Next Steps

1. Implement `ChessEngine` service with chess.js
2. Build socket authentication middleware
3. Create `GameManager` with Firebase persistence
4. Implement `ClockService` with timeout detection
5. Wire up move validation pipeline
6. Add reconnection handler
7. Implement game termination logic
8. Build matchmaking service
9. Add anti-cheat analytics
10. Deploy with Redis for hot state
