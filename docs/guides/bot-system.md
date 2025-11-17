# Bot Chess System

This guide explains how to implement and use the bot chess system for playing against AI opponents.

## Overview

The bot system allows players to play chess against Stockfish-powered AI opponents with three difficulty levels: **easy**, **medium**, and **hard**. The system automatically manages bot moves and integrates seamlessly with the existing game infrastructure.

## Architecture

### Components

1. **BotService** (`src/services/bot/BotService.ts`)
   - Manages individual Stockfish engine instances
   - Handles move generation based on difficulty level
   - Supports multiple difficulty configurations

2. **BotManager** (`src/services/bot/BotService.ts`)
   - Manages multiple bot instances across different games
   - Handles bot lifecycle (creation, retrieval, termination)
   - Tracks active bot games

3. **Chess Gateway** (`src/modules/chess/chessGateway.ts`)
   - Handles `play-with-bot` Socket.IO event
   - Automatically triggers bot moves after player moves
   - Manages bot game cleanup on game completion

## Difficulty Levels

| Difficulty | Depth | Skill Level | Move Time | Description |
|------------|-------|-------------|-----------|-------------|
| **easy** | 1 | 1 | 500ms | Beginner-friendly, makes simple moves |
| **medium** | 5 | 10 | 1000ms | Balanced gameplay for intermediate players |
| **hard** | 15 | 20 | 2000ms | Challenging opponent for advanced players |

## Socket.IO Events

### Client → Server

#### `play-with-bot`

Start a new game against a bot opponent.

**Payload:**
```typescript
{
  difficulty: 'easy' | 'medium' | 'hard';
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  gameId?: string;
  color?: 'white' | 'black';
  error?: string;
}
```

**Example:**
```javascript
socket.emit('play-with-bot', {
  difficulty: 'medium',
  timeControl: {
    initialTimeMs: 600000,  // 10 minutes
    incrementMs: 0
  }
}, (response) => {
  if (response.success) {
    console.log(`Bot game started: ${response.gameId}`);
    console.log(`You are playing as: ${response.color}`);
  }
});
```

### Server → Client

#### `game-starting`

Sent when the bot game is created and ready to start.

**Payload:**
```typescript
{
  gameId: string;
  whitePlayer: { uid: string; socketId?: string };
  blackPlayer: { uid: string; socketId?: string };
  playerColor: 'white' | 'black';
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
  fen: string;
}
```

#### `move-made`

Sent when the bot makes a move (same format as player moves).

**Payload:**
```typescript
{
  gameId: string;
  move: {
    from: string;
    to: string;
    promotion?: string;
    san: string;
  };
  fen: string;
  currentTurn: 'white' | 'black';
  gameStatus: 'active' | 'completed';
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
}
```

## Implementation Details

### Bot Player Identification

- Bot players are identified by the UID `'BOT'`
- Bot socket ID is set to `'BOT_SOCKET'`
- Only one player (human) has a real socket connection

### Color Assignment

When starting a bot game, the player's color is randomly assigned:
```typescript
const playerColor = Math.random() < 0.5 ? 'white' : 'black';
```

### Bot Move Flow

1. **Player makes move** → Move applied to game
2. **Check next turn** → If bot's turn, schedule bot move
3. **Bot calculates** → Stockfish analyzes position (500ms-2000ms)
4. **Bot moves** → Move applied and emitted to player
5. **Repeat** → Continue until game ends

### Automatic Bot Moves

After each player move, the system checks if it's the bot's turn:

```typescript
const nextPlayer = game.turn === 'w' ? game.whitePlayer : game.blackPlayer;
if (nextPlayer.uid === 'BOT') {
  setTimeout(async () => {
    await makeBotMove(gameId, chessNs);
  }, 800);
}
```

### Bot Cleanup

Bots are automatically cleaned up when:
- Game ends (checkmate, draw, resignation)
- Player disconnects
- Server shutdown

```typescript
if (updatedGame.status === 'completed') {
  botManager.removeBot(gameId);
}
```

## Frontend Integration

### Basic Bot Game Flow

```javascript
import { io } from 'socket.io-client';

// Connect to chess namespace
const socket = io('http://localhost:8080/chess', {
  auth: { token: idToken }
});

// Start bot game
function playWithBot(difficulty) {
  socket.emit('play-with-bot', {
    difficulty: difficulty,
    timeControl: {
      initialTimeMs: 600000,  // 10 minutes
      incrementMs: 0
    }
  }, (response) => {
    if (response.success) {
      console.log('Bot game created:', response.gameId);
      console.log('Your color:', response.color);
    } else {
      console.error('Failed to create bot game:', response.error);
    }
  });
}

// Listen for game start
socket.on('game-starting', (data) => {
  console.log('Bot game starting:', data);
  // Initialize chess board with data.fen
  // Set player color to data.playerColor
});

// Listen for bot moves
socket.on('move-made', (data) => {
  console.log('Move made:', data);
  // Update chess board with new FEN
  // Apply move animation
});

// Listen for game over
socket.on('game-over', (data) => {
  console.log('Game over:', data);
  // Show game result
});

// Make player move
function makeMove(from, to, promotion) {
  socket.emit('make-move', {
    gameId: currentGameId,
    from,
    to,
    promotion
  }, (response) => {
    if (response.success) {
      // Move accepted, bot will respond automatically
    } else {
      console.error('Invalid move:', response.error);
    }
  });
}

// Start a medium difficulty bot game
playWithBot('medium');
```

### UI Recommendations

1. **Difficulty Selector**
   ```jsx
   <select onChange={(e) => playWithBot(e.target.value)}>
     <option value="easy">Easy</option>
     <option value="medium">Medium</option>
     <option value="hard">Hard</option>
   </select>
   ```

2. **Bot Move Indicator**
   - Show "Bot is thinking..." message
   - Display spinner or loading animation
   - Disable board during bot turn

3. **Bot Identification**
   - Display bot icon or avatar
   - Show "Stockfish (Medium)" as opponent name
   - Indicate difficulty level in UI

## Testing

### Manual Testing

1. Start the server:
   ```bash
   npm run dev
   ```

2. Connect to `/chess` namespace with valid Firebase token

3. Emit `play-with-bot` event with desired difficulty

4. Make moves and observe bot responses

### Unit Tests

Run bot service tests:
```bash
npm test -- BotService.test.ts
```

Tests cover:
- Bot initialization
- Difficulty level configuration
- Move generation
- Bot manager lifecycle
- Multiple concurrent bot games

## Performance Considerations

### Move Time Budgets

- **Easy**: 500ms - Quick responses for beginners
- **Medium**: 1000ms - Balanced thinking time
- **Hard**: 2000ms - Longer calculation for stronger play

### Memory Management

- Each bot instance maintains its own Stockfish engine
- Engines are terminated when games end
- BotManager tracks all active bots
- Use `terminateAll()` on server shutdown

### Concurrency

- Multiple bot games can run simultaneously
- Each game has its own bot instance
- Bot moves are scheduled with `setTimeout` to avoid blocking

## Troubleshooting

### Bot doesn't respond

**Check:**
1. Bot was created successfully: `botManager.getBot(gameId)`
2. It's the bot's turn: `game.turn` matches bot's color
3. Game is still active: `game.status === 'active'`
4. Stockfish initialized: `bot.ready() === true`

### Move timeout errors

**Solution:**
- Increase `moveTime` in difficulty config
- Check Stockfish initialization logs
- Verify valid FEN position

### Bot makes invalid moves

**Check:**
1. FEN string is valid
2. Move parsing is correct (from/to/promotion)
3. GameManager validates moves properly

## Advanced Configuration

### Custom Difficulty

Create custom bot configurations:

```typescript
const customBot = new BotService('medium');
await customBot.initialize();

// Override difficulty config
customBot.config = {
  depth: 10,
  skillLevel: 15,
  moveTime: 1500
};
```

### Bot Personality

Adjust Stockfish UCI options:

```typescript
engine.postMessage('setoption name Skill Level value 10');
engine.postMessage('setoption name Contempt value 24');
engine.postMessage('setoption name Aggressiveness value 150');
```

## Related Documentation

- [Room System](./room-system.md) - Multiplayer game rooms
- [Chess Namespace](../realtime/chess-namespace.md) - All Socket.IO events
- [GameManager](../architecture/chess-engine.md) - Game state management

## API Reference

### BotService

```typescript
class BotService {
  constructor(difficulty: BotDifficulty);
  async initialize(): Promise<void>;
  async getBestMove(fen: string): Promise<string>;
  terminate(): void;
  getDifficulty(): BotDifficulty;
  ready(): boolean;
}
```

### BotManager

```typescript
class BotManager {
  async createBot(gameId: string, difficulty: BotDifficulty): Promise<BotService>;
  getBot(gameId: string): BotService | undefined;
  removeBot(gameId: string): void;
  getActiveBotGames(): string[];
  terminateAll(): void;
}
```

## Best Practices

1. **Always clean up bots** when games end
2. **Validate difficulty** before creating bot
3. **Handle timeouts** gracefully
4. **Show visual feedback** during bot moves
5. **Test all difficulty levels** thoroughly
6. **Monitor memory usage** with many concurrent bots
7. **Log bot errors** for debugging

## Future Enhancements

Potential improvements:
- Opening book integration
- Endgame tablebase support
- Adjustable playing styles (aggressive, defensive)
- Bot rating system
- Move hints from bot
- Analysis mode after game
