# Firebase Database Schema

Production-level schema design for real-time chess backend using Firebase Realtime Database.

## Collections Structure

### `/users/{uid}`
Stores player profiles, ratings, and statistics.

```json
{
  "uid": "firebase-auth-uid",
  "displayName": "Player123",
  "email": "player@example.com",
  "rating": 1500,
  "gamesPlayed": 42,
  "wins": 20,
  "losses": 18,
  "draws": 4,
  "createdAt": 1700000000000,
  "lastActive": 1731700000000,
  "stats": {
    "bullet": { "rating": 1450, "games": 10 },
    "blitz": { "rating": 1520, "games": 20 },
    "rapid": { "rating": 1530, "games": 12 }
  }
}
```

### `/games/{gameId}`
Core game state (authoritative).

```json
{
  "gameId": "nanoid-generated-id",
  "status": "active",
  "variant": "standard",
  "timeControl": {
    "type": "blitz",
    "initialTime": 300000,
    "increment": 2000
  },
  "players": {
    "white": {
      "uid": "user-uid-1",
      "displayName": "Alice",
      "rating": 1520,
      "timeRemaining": 298000,
      "connected": true
    },
    "black": {
      "uid": "user-uid-2",
      "displayName": "Bob",
      "rating": 1505,
      "timeRemaining": 295000,
      "connected": true
    }
  },
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "pgn": "",
  "turn": "white",
  "moveCount": 0,
  "lastMoveAt": 1731700000000,
  "createdAt": 1731700000000,
  "result": null,
  "winner": null,
  "endReason": null
}
```

### `/games/{gameId}/moves/{moveNumber}`
Move history (immutable once written).

```json
{
  "moveNumber": 1,
  "uid": "user-uid-1",
  "color": "white",
  "san": "e4",
  "uci": "e2e4",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "timestamp": 1731700005000,
  "timeRemaining": 298000,
  "thinkTime": 5000,
  "flagged": false
}
```

### `/matchmaking/queue/{timeControl}`
Active matchmaking pool.

```json
{
  "uid": "user-uid-1",
  "rating": 1520,
  "ratingRange": [1420, 1620],
  "joinedAt": 1731700000000,
  "preferences": {
    "variant": "standard",
    "color": "random"
  }
}
```

### `/activeGames/{uid}`
Quick lookup for user's current games.

```json
{
  "gameId": "game-id-123",
  "color": "white",
  "opponent": "Bob",
  "status": "active"
}
```

### `/spectators/{gameId}/{uid}`
Track spectators for broadcast control.

```json
{
  "uid": "spectator-uid",
  "joinedAt": 1731700000000
}
```

## Security Rules

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": true,
        ".write": "$uid === auth.uid"
      }
    },
    "games": {
      "$gameId": {
        ".read": true,
        ".write": "auth != null && (
          data.child('players/white/uid').val() === auth.uid ||
          data.child('players/black/uid').val() === auth.uid
        )"
      }
    },
    "matchmaking": {
      "queue": {
        "$timeControl": {
          "$uid": {
            ".read": true,
            ".write": "$uid === auth.uid"
          }
        }
      }
    },
    "activeGames": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```

## Indexes

Configure these indexes in Firebase Console for optimal queries:

```json
{
  "rules": {
    "matchmaking": {
      "queue": {
        "$timeControl": {
          ".indexOn": ["rating", "joinedAt"]
        }
      }
    },
    "games": {
      ".indexOn": ["status", "createdAt"]
    }
  }
}
```

## Data Flow

### Game Creation
1. Server creates `/games/{gameId}` with initial state
2. Server updates `/activeGames/{whiteUid}` and `/activeGames/{blackUid}`
3. Server broadcasts `game-start` event to both players

### Move Submission
1. Client emits `make-move` with `{ gameId, move }`
2. Server validates authentication and turn
3. Server validates move with chess.js
4. Server writes to `/games/{gameId}/moves/{moveNumber}`
5. Server updates `/games/{gameId}` FEN, turn, clocks atomically
6. Server broadcasts `move-made` to room participants

### Clock Updates
1. Server maintains authoritative clock in memory
2. On move, server updates `timeRemaining` in database
3. Server broadcasts `clock-update` every second to active players
4. On timeout, server writes game result and broadcasts `game-over`

### Reconnection
1. Client reconnects with uid from session
2. Server queries `/activeGames/{uid}` to find current game
3. Server reads `/games/{gameId}` and `/games/{gameId}/moves`
4. Server sends full snapshot via `game-state` event

## Scalability Considerations

- Use Redis for hot game state (active clocks, recent moves)
- Keep Firebase as source of truth for persistence
- Implement write-behind cache strategy for move history
- Use Firebase Cloud Functions for rating calculations
- Archive completed games to Cloud Storage after 30 days
