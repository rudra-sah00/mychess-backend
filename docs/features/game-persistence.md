# Game Persistence & Reconnection System

## Overview

The backend now includes a comprehensive game persistence system that:
- Saves active games to Firebase Realtime Database
- Handles player disconnections with 1-minute reconnection window
- Automatically saves match history when games end
- Cleans up stale games periodically

## Features

### 1. Active Game Persistence

When a player starts a game (bot or PvP), the game state is saved to:
```
activeGames/{uid}/
  gameId: string
  type: "bot" | "pvp"
  playerUid: string
  opponentUid?: string
  playerColor: "white" | "black"
  fen: string
  startedAt: number
  lastUpdateAt: number
  status: "active" | "disconnected"
  timeControl: {...}
  whiteTime: number
  blackTime: number
```

### 2. Automatic Reconnection

When a player connects to the chess namespace:
- Backend checks if they have an active game
- If found, emits `active-game-found` event with game data
- Player can resume the game from where they left off

### 3. Disconnection Handling

When a player disconnects:
- Game state is marked as "disconnected"
- 1-minute timeout starts
- If player doesn't reconnect within 1 minute:
  - Game ends automatically
  - Opponent wins by disconnection
  - Match saved to history
  - Active game removed from persistence

### 4. Match History

When a game ends (by any means), it's saved to:
```
matchHistory/{uid}/
  {matchId}/
    matchId: string
    gameType: "bot" | "pvp"
    result: "win" | "loss" | "draw"
    playerColor: "white" | "black"
    opponent:
      name: string
      uid: string
    startTime: number
    endTime: number
    duration: number (seconds)
    winner: "white" | "black" | "draw"
```

## Client Events

### New Events to Listen For

**`active-game-found`**
```typescript
{
  gameId: string
  gameData: {
    ...game state
    reconnecting: true
  }
}
```
Emitted when client connects and has an active game.

**`player-disconnected`**
```typescript
{
  uid: string
}
```
Emitted to opponent when player disconnects.

**`player-reconnected`**
```typescript
{
  color: "white" | "black"
}
```
Emitted to opponent when player reconnects.

## Database Structure

### Firebase Realtime Database

```
/activeGames/
  {uid}/  // One active game per player
    gameId: string
    type: "bot" | "pvp"
    ...game state

/matchHistory/
  {uid}/
    {pushId}/  // Multiple matches per player
      matchId: string
      result: "win" | "loss" | "draw"
      ...match data
```

### Data Saved

**For Bot Games:**
- Player UID
- Bot difficulty level (stored as opponent name)
- Game outcome
- Duration
- Time control

**For PvP Games:**
- Both player UIDs
- Player names (from socket connection)
- Game outcome
- Duration
- Time control

**NOT Saved:**
- Full move history (too large)
- Complete FEN history
- Chat messages
- Individual move timestamps

## API Usage

### Check for Active Game
```typescript
// Called automatically on connection
// Listen for 'active-game-found' event
socket.on('active-game-found', (data) => {
  // Prompt user to resume game
  router.push(`/game/${data.gameId}`);
});
```

### Get Match History
```typescript
// Get user's match history
const history = await gamePersistenceService.getMatchHistory(uid, limit);
```

### Manual Cleanup
```typescript
// Remove active game (e.g., when player explicitly quits)
await gamePersistenceService.removeActiveGame(uid);
```

## Configuration

### Reconnection Timeout
Default: 60 seconds (1 minute)

To change, modify in `GamePersistenceService.ts`:
```typescript
private RECONNECT_TIMEOUT = 60000; // milliseconds
```

### Stale Game Cleanup
Default: Games older than 1 hour are removed

Cleanup runs every 10 minutes (configured in `server.ts`)

### Cleanup Delay
Games are cleaned up 30 seconds after completion (configurable in GameManager)

## Security Considerations

1. **Data Privacy**: Only the player can access their active game and match history
2. **UID-based**: All data is keyed by Firebase UID (authenticated users only)
3. **Auto-cleanup**: Stale games are automatically removed
4. **Minimal Data**: Only essential game data is stored, not full move history

## Performance

- Active games: O(1) read/write per player
- Match history: O(n) where n = number of matches (paginated)
- Cleanup: O(n) where n = number of stale games (runs periodically)
- Memory: One active game per connected player

## Testing

### Test Disconnection
1. Start a game
2. Close browser/lose connection
3. Reconnect within 1 minute
4. Should see active game prompt

### Test Timeout
1. Start a game
2. Disconnect
3. Wait > 1 minute
4. Check opponent - game should end

### Test Match History
1. Complete a game
2. Check `matchHistory/{uid}` in Firebase
3. Should see match record

## Migration

No migration needed - system creates data on first use.

To clear all persistence data:
```
/activeGames/ - delete all
/matchHistory/ - keep for history
```

## Future Enhancements

Possible additions:
- Full game replay (save complete move history)
- Spectator mode support
- Tournament bracket persistence
- ELO rating system integration
- Statistics aggregation (win rate, common openings, etc.)
