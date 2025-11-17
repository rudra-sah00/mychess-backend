# Bot Chess Quick Start

Quick examples for implementing bot chess gameplay in your frontend.

## Basic Setup

```javascript
import { io } from 'socket.io-client';

// Connect to chess namespace
const socket = io('http://localhost:8080/chess', {
  auth: { token: firebaseIdToken }
});

let currentGameId = null;
let playerColor = null;
```

## Start Bot Game

```javascript
function startBotGame(difficulty) {
  socket.emit('play-with-bot', {
    difficulty: difficulty, // 'easy', 'medium', or 'hard'
    timeControl: {
      initialTimeMs: 600000,  // 10 minutes
      incrementMs: 0
    }
  }, (response) => {
    if (response.success) {
      currentGameId = response.gameId;
      playerColor = response.color;
      console.log(`Playing as ${playerColor} vs ${difficulty} bot`);
    } else {
      console.error('Failed:', response.error);
    }
  });
}

// Start a medium difficulty game
startBotGame('medium');
```

## Listen for Game Start

```javascript
socket.on('game-starting', (data) => {
  console.log('Game starting:', data);
  // {
  //   gameId: 'abc123',
  //   whitePlayer: { uid: 'user-id', socketId: '...' },
  //   blackPlayer: { uid: 'BOT', socketId: 'BOT_SOCKET' },
  //   playerColor: 'white',
  //   fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  //   timeControl: { initialTimeMs: 600000, incrementMs: 0 }
  // }
  
  // Initialize your chess board
  initializeBoard(data.fen);
  setPlayerSide(data.playerColor);
});
```

## Make Moves

```javascript
function makeMove(from, to, promotion = null) {
  socket.emit('make-move', {
    gameId: currentGameId,
    from: from,      // e.g., 'e2'
    to: to,          // e.g., 'e4'
    promotion: promotion  // 'q', 'r', 'b', 'n' for pawn promotion
  }, (response) => {
    if (!response.success) {
      console.error('Invalid move:', response.error);
    }
    // Bot will respond automatically after valid move
  });
}

// Example: Move pawn from e2 to e4
makeMove('e2', 'e4');
```

## Listen for Bot Moves

```javascript
socket.on('move-made', (data) => {
  console.log('Move made:', data);
  // {
  //   gameId: 'abc123',
  //   move: { from: 'e7', to: 'e5', san: 'e5' },
  //   fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
  //   currentTurn: 'white',
  //   gameStatus: 'active',
  //   isCheck: false,
  //   isCheckmate: false,
  //   isDraw: false
  // }
  
  // Update board with new position
  updateBoard(data.fen);
  
  // Animate the move
  animateMove(data.move.from, data.move.to);
  
  // Update turn indicator
  updateTurnIndicator(data.currentTurn);
});
```

## Handle Game Over

```javascript
socket.on('game-over', (data) => {
  console.log('Game over:', data);
  // {
  //   winner: 'white' | 'black' | 'draw',
  //   reason: 'checkmate' | 'resignation' | 'timeout' | 'stalemate' | 'agreement',
  //   finalFen: '...',
  //   pgn: '1. e4 e5 2. Nf3...'
  // }
  
  showGameResult(data.winner, data.reason);
});
```

## Complete React Example

```jsx
import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Chessboard } from 'react-chessboard';

function BotChess({ firebaseToken }) {
  const [socket, setSocket] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [fen, setFen] = useState('start');
  const [playerColor, setPlayerColor] = useState(null);
  const [gameStatus, setGameStatus] = useState('idle');
  const [botThinking, setBotThinking] = useState(false);

  useEffect(() => {
    const newSocket = io('http://localhost:8080/chess', {
      auth: { token: firebaseToken }
    });

    newSocket.on('game-starting', (data) => {
      setGameId(data.gameId);
      setPlayerColor(data.playerColor);
      setFen(data.fen);
      setGameStatus('playing');
    });

    newSocket.on('move-made', (data) => {
      setFen(data.fen);
      setBotThinking(false);
      
      // If it's bot's turn again, show thinking indicator
      const nextPlayer = data.currentTurn === 'white' 
        ? data.whitePlayer 
        : data.blackPlayer;
      if (nextPlayer?.uid === 'BOT') {
        setBotThinking(true);
      }
    });

    newSocket.on('game-over', (data) => {
      setGameStatus('finished');
      setBotThinking(false);
      alert(`Game over: ${data.winner} wins by ${data.reason}`);
    });

    setSocket(newSocket);

    return () => newSocket.close();
  }, [firebaseToken]);

  const startGame = (difficulty) => {
    socket.emit('play-with-bot', {
      difficulty,
      timeControl: {
        initialTimeMs: 600000,
        incrementMs: 0
      }
    }, (response) => {
      if (!response.success) {
        alert('Failed to start game: ' + response.error);
      }
    });
  };

  const onDrop = (sourceSquare, targetSquare) => {
    if (gameStatus !== 'playing') return false;
    if (botThinking) return false;

    socket.emit('make-move', {
      gameId,
      from: sourceSquare,
      to: targetSquare
    }, (response) => {
      if (response.success) {
        // Check if bot will move next
        setBotThinking(true);
        return true;
      } else {
        alert('Invalid move: ' + response.error);
        return false;
      }
    });

    return false; // Wait for server response
  };

  return (
    <div>
      <h1>Play vs Bot</h1>
      
      {gameStatus === 'idle' && (
        <div>
          <button onClick={() => startGame('easy')}>Easy</button>
          <button onClick={() => startGame('medium')}>Medium</button>
          <button onClick={() => startGame('hard')}>Hard</button>
        </div>
      )}

      {gameStatus === 'playing' && (
        <>
          <div>Playing as {playerColor}</div>
          {botThinking && <div>🤖 Bot is thinking...</div>}
          <Chessboard
            position={fen}
            onPieceDrop={onDrop}
            boardOrientation={playerColor}
          />
        </>
      )}
    </div>
  );
}

export default BotChess;
```

## Difficulty Levels Explained

### Easy (Depth: 1, Skill: 1)
- Best for beginners
- Makes moves quickly (~500ms)
- Often makes mistakes
- Good for learning

### Medium (Depth: 5, Skill: 10)
- Balanced difficulty
- Thinks for ~1 second
- Plays solid chess
- Good for intermediate players

### Hard (Depth: 15, Skill: 20)
- Challenging opponent
- Thinks for ~2 seconds
- Plays strong chess
- Good for advanced players

## Tips for Frontend Implementation

### 1. Show Bot Thinking State
```javascript
let botThinking = false;

socket.on('move-made', (data) => {
  // Check if next turn is bot
  if (isNextPlayerBot(data)) {
    botThinking = true;
    showBotThinking();
  } else {
    botThinking = false;
    hideBotThinking();
  }
});
```

### 2. Disable Board During Bot Turn
```javascript
const canMove = !botThinking && 
                gameStatus === 'playing' && 
                currentTurn === playerColor;

<Chessboard
  position={fen}
  onPieceDrop={canMove ? onDrop : null}
/>
```

### 3. Handle Errors Gracefully
```javascript
socket.emit('play-with-bot', { difficulty }, (response) => {
  if (!response.success) {
    if (response.error === 'Invalid difficulty level') {
      alert('Please choose easy, medium, or hard');
    } else {
      alert('Failed to start game. Please try again.');
    }
  }
});
```

### 4. Show Bot Identity
```jsx
<div className="opponent">
  <img src="/bot-icon.png" alt="Bot" />
  <span>Stockfish ({difficulty.toUpperCase()})</span>
</div>
```

## Common Issues

### Bot doesn't respond
- Check console for errors
- Verify Socket.IO connection
- Ensure it's actually bot's turn

### Moves rejected
- Validate moves client-side first
- Check if it's your turn
- Ensure game is active

### Connection drops
- Implement reconnection logic
- Save gameId to resume
- Handle connection_error event

## Next Steps

- [Complete Bot System Guide](../guides/bot-system.md)
- [Chess Namespace Events](../realtime/chess-namespace.md)
- [Room System](./room-quickstart.md)

## Testing

Test bot integration:

```bash
# Start backend
cd mychess-backend
npm run dev

# In browser console
const socket = io('http://localhost:8080/chess', {
  auth: { token: 'YOUR_FIREBASE_TOKEN' }
});

socket.emit('play-with-bot', { difficulty: 'medium' }, console.log);
```

Monitor backend logs for:
```
[info]: Bot game abc123 created: user-id (white) vs Bot (black, medium)
[debug]: [Bot] Calculating move for game abc123
[info]: [Bot] Making move in game abc123: e7 -> e5
```
