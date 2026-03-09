# Database Schema

Comprehensive schema design for the MyChess backend using PostgreSQL (via Prisma) and Redis.

## PostgreSQL Schema (Persistence)

Managed via Prisma, focusing on user profiles and game history.

### User Model
Stores player profiles, ratings, and authentication data.

```prisma
model User {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  rating       Int      @default(1200)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  gamesAsWhite Game[]   @relation("GamesAsWhite")
  gamesAsBlack Game[]   @relation("GamesAsBlack")
  gamesWon     Game[]   @relation("GamesWon")
}
```

### Game Model
Core game history for completed matches.

```prisma
model Game {
  id        String   @id @default(uuid())
  whiteId   String
  blackId   String
  pgn       String   @default("")
  status    String   @default("active") // active, draw, white_won, black_won
  winnerId  String?
  createdAt DateTime @default(now())
  endedAt   DateTime?

  whitePlayer User  @relation("GamesAsWhite", fields: [whiteId], references: [id])
  blackPlayer User  @relation("GamesAsBlack", fields: [blackId], references: [id])
  winner      User? @relation("GamesWon", fields: [winnerId], references: [id])
}
```

## Redis Schema (Real-time & Ephemeral)

Used for hot game state, matchmaking, and room management.

### Active Game State (`game:{gameId}`)
JSON blob for fast access to current FEN, turn, and clock status.

```json
{
  "gameId": "nanoid-10",
  "whitePlayer": { "uid": "user-1", "socketId": "sock-1", "name": "Alice" },
  "blackPlayer": { "uid": "user-2", "socketId": "sock-2", "name": "Bob" },
  "fen": "rnbqkbnr/...",
  "pgn": "1. e4...",
  "status": "active",
  "turn": "w",
  "clockState": {
    "whiteTimeMs": 600000,
    "blackTimeMs": 600000,
    "activeColor": "w"
  }
}
```

### Matchmaking Queue (`matchmaking:queue`)
Redis Sorted Set where Score is the player's rating and Value is their UID.

### Room Management (`room:{roomId}`)
JSON blob storing room occupancy, privacy settings, and ready status.

### Active Sessions (`activeGame:{uid}`)
Quick lookup for a user's current active game ID for reconnection handling.

## Data Flow

### Game Creation
1. Matchmaking or Room Service identifies a match.
2. `GameManager` creates a record in Redis (`game:{gameId}`).
3. A skeleton record is created in PostgreSQL for PvP games.
4. Players are notified via `match-found` or `game-starting`.

### Move Submission
1. Client emits `make-move` via Socket.io.
2. Server validates turn and move legitimacy.
3. Server updates Redis state atomically.
4. Move is appended to Redis history (`game:{gameId}:moves`).
5. On game end, final PGN and results are persisted to PostgreSQL.

### Reconnection
1. Client establishes new socket connection with JWT.
2. Server checks Redis `activeGame:{uid}`.
3. If found, full state is loaded from `game:{gameId}` and sent to client.
