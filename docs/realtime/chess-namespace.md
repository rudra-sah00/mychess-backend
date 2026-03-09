# Chess Realtime Namespace (`/chess`)

Core Socket.io namespace for live games, matchmaking, and player interaction.

## Authentication
Authentication is enforced via JWT stored in HTTP-only cookies.
The `socketAuth.ts` middleware verifies the session before allowing a connection.

---

## Matches & Gameplay

### Event: `join-game`
Join an active game room.
- Params: `{ gameId }`

### Event: `make-move`
Submit a move to the server.
- Params: `{ gameId, move }` (UCI or SAN)

### Event: `resign`
Resign the current game.
- Params: `{ gameId }`

### Event: `offer-draw`
Offer or accept a draw.
- Params: `{ gameId }`

### Event: `game-state` (Server-to-Client)
Full snapshot of game state on join or reconnect.

---

## Matchmaking

### Event: `join-queue`
Enter the matchmaking pool.
- Params: `{ timeControl, variant, preferences }`

### Event: `leave-queue`
Exit the matchmaking pool.

### Event: `match-found` (Server-to-Client)
Notifies that a match has been found and provides the `gameId`.

---

## Bot Play

### Event: `play-bot`
Start a game against the Stockfish engine.
- Params: `{ level, color, timeControl }`

### Event: `bot-move` (Server-to-Client)
Sent when the bot calculates and makes its move.

---

## Room System

### Event: `create-room`
Create a custom game room for friends.

### Event: `join-room`
Join a room via code.

### Event: `player-ready`
Indicate readiness to start the game.
