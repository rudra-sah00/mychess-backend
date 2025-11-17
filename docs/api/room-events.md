# Room API Events Reference

Complete Socket.IO event documentation for room-based chess gameplay.

## Overview

Rooms allow players to create lobbies where exactly 2 players can join and play chess. Rooms support:
- **Public Rooms**: Anyone can join with just the room ID
- **Private Rooms**: Require a password to join
- **Time Controls**: Optional chess clock settings
- **Ready System**: Both players must ready up before game starts

## Room Events

### `create-room`
Create a new room (public or private).

**Client → Server**
```typescript
socket.emit('create-room', {
  name?: 'My Chess Room',           // Optional room name
  isPrivate?: false,                 // true for private, false/undefined for public
  password?: 'secret123',            // Required if isPrivate is true
  timeControl?: {
    initialTimeMs: 300000,           // 5 minutes
    incrementMs: 3000                // 3 second increment
  }
}, (response) => {
  if (response.success) {
    console.log('Room created:', response.room);
    // Navigate to room lobby
  } else {
    console.error(response.error);
  }
});
```

**Response**
```typescript
{
  success: true,
  room: {
    roomId: 'abc12345',
    name: 'My Chess Room',
    hostUid: 'user-123',
    players: [
      {
        uid: 'user-123',
        socketId: 'socket-xyz',
        joinedAt: 1731700000000,
        isReady: false
      }
    ],
    maxPlayers: 2,
    status: 'waiting',              // 'waiting' | 'ready' | 'playing' | 'completed'
    isPrivate: false,
    password?: 'secret123',         // Only if private
    timeControl?: {
      initialTimeMs: 300000,
      incrementMs: 3000
    },
    createdAt: 1731700000000
  }
}
```

**Examples**

Create a public room:
```typescript
socket.emit('create-room', {
  name: 'Quick Game',
}, callback);
```

Create a private room with password:
```typescript
socket.emit('create-room', {
  name: 'Friends Only',
  isPrivate: true,
  password: 'mypassword123'
}, callback);
```

Create a room with time control:
```typescript
socket.emit('create-room', {
  name: 'Blitz 5+3',
  timeControl: {
    initialTimeMs: 300000,  // 5 minutes
    incrementMs: 3000       // 3 seconds
  }
}, callback);
```

---

### `join-room`
Join an existing room.

**Client → Server**
```typescript
socket.emit('join-room', {
  roomId: 'abc12345',
  password?: 'secret123'    // Required for private rooms
}, (response) => {
  if (response.success) {
    console.log('Joined room:', response.room);
  } else {
    console.error(response.error);
    // Errors: 'Room not found', 'Invalid password', 'Room is full', etc.
  }
});
```

**Response (Success)**
```typescript
{
  success: true,
  room: {
    roomId: 'abc12345',
    name: 'My Chess Room',
    hostUid: 'user-123',
    players: [
      { uid: 'user-123', socketId: 'socket-1', joinedAt: 1731700000000, isReady: false },
      { uid: 'user-456', socketId: 'socket-2', joinedAt: 1731700005000, isReady: false }
    ],
    status: 'ready',          // Changes to 'ready' when 2 players join
    // ... other room data
  }
}
```

**Response (Error)**
```typescript
{
  success: false,
  error: 'Room not found' | 'Invalid password' | 'Room is full' | 'Already in another room' | 'Room is already in game'
}
```

**Examples**

Join a public room:
```typescript
socket.emit('join-room', {
  roomId: 'abc12345'
}, callback);
```

Join a private room:
```typescript
socket.emit('join-room', {
  roomId: 'xyz98765',
  password: 'mypassword123'
}, callback);
```

---

### `leave-room`
Leave the current room.

**Client → Server**
```typescript
socket.emit('leave-room', (response) => {
  if (response.success) {
    console.log('Left room');
    if (response.disbanded) {
      console.log('Room was disbanded');
    }
  }
});
```

**Response**
```typescript
{
  success: true,
  disbanded?: boolean    // true if room was disbanded (host left or last player)
}
```

**Notes:**
- If the host leaves, the room is disbanded
- If the last player leaves, the room is disbanded
- Other players are notified via `player-left-room` or `room-disbanded` events

---

### `set-ready`
Toggle your ready status in the room.

**Client → Server**
```typescript
socket.emit('set-ready', {
  isReady: true    // true to ready up, false to un-ready
}, (response) => {
  if (response.success) {
    console.log('Ready status updated');
    if (response.allReady) {
      console.log('All players ready! Game starting...');
    }
  }
});
```

**Response**
```typescript
{
  success: true,
  allReady?: boolean    // true if all players are ready (triggers game start)
}
```

**Game Start Flow:**
1. Player 1 sets ready: `isReady: true`
2. Player 2 sets ready: `isReady: true`
3. Server detects `allReady: true`
4. Server creates the game automatically
5. All players receive `game-starting` event
6. Game begins!

---

### `list-rooms`
Get all available public rooms.

**Client → Server**
```typescript
socket.emit('list-rooms', (response) => {
  if (response.success) {
    response.rooms.forEach(room => {
      console.log(`${room.name} (${room.players.length}/${room.maxPlayers})`);
    });
  }
});
```

**Response**
```typescript
{
  success: true,
  rooms: [
    {
      roomId: 'abc12345',
      name: 'Quick Game',
      hostUid: 'user-123',
      players: [/* ... */],
      maxPlayers: 2,
      status: 'waiting',
      isPrivate: false,
      timeControl?: { /* ... */ },
      createdAt: 1731700000000
    },
    // ... more public rooms
  ]
}
```

**Notes:**
- Only returns **public** rooms (isPrivate: false)
- Only returns rooms that are **not full** (players.length < maxPlayers)
- Only returns rooms in **waiting** or **ready** status (not playing/completed)
- Private rooms never appear in this list

---

### `get-current-room`
Get your current room data.

**Client → Server**
```typescript
socket.emit('get-current-room', (response) => {
  if (response.success) {
    console.log('Current room:', response.room);
  } else {
    console.log('Not in a room');
  }
});
```

**Response**
```typescript
{
  success: true,
  room: {
    roomId: 'abc12345',
    // ... full room data
  }
}
// OR
{
  success: false,
  error: 'Not in a room'
}
```

---

## Server → Client Events

### `player-joined-room`
Broadcasted when a player joins your room.

**Server → Clients**
```typescript
socket.on('player-joined-room', (data) => {
  console.log(`${data.player.uid} joined the room`);
  // Update UI with new player
});
```

**Payload**
```typescript
{
  roomId: 'abc12345',
  player: {
    uid: 'user-456',
    joinedAt: 1731700005000,
    isReady: false
  },
  room: {
    // ... full updated room data
  }
}
```

---

### `player-left-room`
Broadcasted when a player leaves your room.

**Server → Clients**
```typescript
socket.on('player-left-room', (data) => {
  console.log(`${data.uid} left the room`);
  // Update UI
});
```

**Payload**
```typescript
{
  roomId: 'abc12345',
  uid: 'user-456',
  room: {
    // ... full updated room data
  }
}
```

---

### `room-disbanded`
Broadcasted when the room is disbanded (host left or last player left).

**Server → Clients**
```typescript
socket.on('room-disbanded', (data) => {
  console.log('Room was disbanded');
  // Navigate back to lobby
});
```

**Payload**
```typescript
{
  roomId: 'abc12345'
}
```

---

### `player-ready-changed`
Broadcasted when a player's ready status changes.

**Server → Clients**
```typescript
socket.on('player-ready-changed', (data) => {
  console.log(`${data.uid} is ${data.isReady ? 'ready' : 'not ready'}`);
  // Update UI to show ready status
});
```

**Payload**
```typescript
{
  roomId: 'abc12345',
  uid: 'user-123',
  isReady: true,
  room: {
    // ... full updated room data
  }
}
```

---

### `game-starting`
Broadcasted when all players are ready and the game is starting.

**Server → Clients**
```typescript
socket.on('game-starting', (data) => {
  console.log('Game starting!');
  console.log('Game ID:', data.gameId);
  console.log('You are:', data.whitePlayer === myUid ? 'white' : 'black');
  
  // Navigate to game board
  // Join the game using join-game event
  socket.emit('join-game', { gameId: data.gameId });
});
```

**Payload**
```typescript
{
  roomId: 'abc12345',
  gameId: 'game-xyz789',
  whitePlayer: 'user-123',
  blackPlayer: 'user-456',
  gameState: {
    gameId: 'game-xyz789',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    turn: 'w',
    status: 'active',
    whitePlayer: { uid: 'user-123', socketId: 'socket-1' },
    blackPlayer: { uid: 'user-456', socketId: 'socket-2' },
    clockState?: {
      whiteTimeMs: 300000,
      blackTimeMs: 300000,
      activeColor: 'w',
      lastUpdateTimestamp: 1731700010000
    }
  }
}
```

---

## Complete Room Flow Example

### Creating and Joining a Public Room

**Player 1 (Host):**
```typescript
// 1. Create a public room
socket.emit('create-room', {
  name: 'Quick Blitz Game',
  timeControl: {
    initialTimeMs: 180000,  // 3 minutes
    incrementMs: 2000       // 2 seconds
  }
}, (response) => {
  if (response.success) {
    const roomId = response.room.roomId;
    console.log('Room created! Share this ID:', roomId);
    
    // 2. Wait for player 2 to join
    socket.on('player-joined-room', (data) => {
      console.log('Player 2 joined!');
      
      // 3. Ready up
      socket.emit('set-ready', { isReady: true });
    });
    
    // 4. Listen for game start
    socket.on('game-starting', (data) => {
      console.log('Game starting! Joining game...');
      socket.emit('join-game', { gameId: data.gameId });
    });
  }
});
```

**Player 2 (Joiner):**
```typescript
// 1. Get the room ID from Player 1
const roomId = 'abc12345';  // Shared by Player 1

// 2. Join the room
socket.emit('join-room', { roomId }, (response) => {
  if (response.success) {
    console.log('Joined room!');
    
    // 3. Listen for Player 1's ready status
    socket.on('player-ready-changed', (data) => {
      console.log('Player 1 ready status:', data.isReady);
    });
    
    // 4. Ready up
    socket.emit('set-ready', { isReady: true }, (response) => {
      if (response.allReady) {
        console.log('Both players ready! Game starting...');
      }
    });
    
    // 5. Listen for game start
    socket.on('game-starting', (data) => {
      console.log('Game starting! Joining game...');
      socket.emit('join-game', { gameId: data.gameId });
    });
  } else {
    console.error('Failed to join:', response.error);
  }
});
```

### Creating and Joining a Private Room

**Player 1 (Host):**
```typescript
// 1. Create a private room with password
socket.emit('create-room', {
  name: 'Private Game - Friends Only',
  isPrivate: true,
  password: 'supersecret123'
}, (response) => {
  if (response.success) {
    const roomId = response.room.roomId;
    console.log('Private room created!');
    console.log('Share with friend: Room ID:', roomId, 'Password:', 'supersecret123');
    // ... same flow as public room
  }
});
```

**Player 2 (Joiner):**
```typescript
// 1. Get room ID and password from Player 1
const roomId = 'xyz98765';
const password = 'supersecret123';

// 2. Join with password
socket.emit('join-room', {
  roomId,
  password
}, (response) => {
  if (response.success) {
    console.log('Joined private room!');
    // ... same flow as public room
  } else {
    console.error('Failed to join:', response.error);
    // Common errors: 'Invalid password', 'Room not found'
  }
});
```

### Browsing and Joining Public Rooms

**Player looking for a game:**
```typescript
// 1. List all available public rooms
socket.emit('list-rooms', (response) => {
  if (response.success) {
    console.log('Available rooms:');
    response.rooms.forEach(room => {
      console.log(`- ${room.name} (${room.players.length}/${room.maxPlayers})`);
      console.log(`  Room ID: ${room.roomId}`);
      console.log(`  Time Control: ${room.timeControl?.initialTimeMs}ms`);
    });
    
    // 2. Pick a room and join
    const chosenRoom = response.rooms[0];
    if (chosenRoom) {
      socket.emit('join-room', {
        roomId: chosenRoom.roomId
      }, (joinResponse) => {
        if (joinResponse.success) {
          console.log('Joined room!');
          // Ready up and wait for game
        }
      });
    }
  }
});
```

---

## Error Handling

### Common Errors

| Error | Reason | Solution |
|-------|--------|----------|
| `Already in a room` | Player is already in another room | Leave current room first |
| `Room not found` | Invalid room ID or room disbanded | Check room ID is correct |
| `Invalid password` | Wrong password for private room | Get correct password from host |
| `Room is full` | Room already has 2 players | Join a different room |
| `Room is already in game` | Room status is 'playing' or 'completed' | Join a different room |
| `Not in a room` | Trying to leave/ready when not in room | Join a room first |

### Error Handling Example

```typescript
socket.emit('join-room', { roomId, password }, (response) => {
  if (!response.success) {
    switch (response.error) {
      case 'Room not found':
        alert('This room no longer exists');
        break;
      case 'Invalid password':
        alert('Incorrect password');
        break;
      case 'Room is full':
        alert('Room is full, try another one');
        break;
      case 'Already in another room':
        // Auto-leave and retry
        socket.emit('leave-room', () => {
          socket.emit('join-room', { roomId, password });
        });
        break;
      default:
        alert('Failed to join room: ' + response.error);
    }
  }
});
```

---

## Room Status Lifecycle

```
waiting → ready → playing → completed
   ↓        ↓        ↓
disbanded (if host/all leave)
```

| Status | Description | Can Join? |
|--------|-------------|-----------|
| `waiting` | 1 player, waiting for opponent | ✅ Yes |
| `ready` | 2 players joined, waiting for ready up | ❌ No (full) |
| `playing` | Game in progress | ❌ No |
| `completed` | Game finished | ❌ No |

---

## Best Practices

1. **Always validate responses**: Check `response.success` before proceeding
2. **Handle disconnections**: On disconnect, player is automatically removed from room
3. **Share room IDs carefully**: For private rooms, share room ID + password securely
4. **List rooms for discovery**: Use `list-rooms` for matchmaking/lobby UI
5. **Handle ready states**: Show visual indicators when players are ready
6. **Auto-join games**: When `game-starting` fires, immediately emit `join-game`
7. **Clean up listeners**: Remove event listeners when leaving rooms
8. **Validate room data**: Check room.status before allowing actions

---

## TypeScript Types

```typescript
interface RoomPlayer {
  uid: string;
  socketId: string;
  joinedAt: number;
  isReady: boolean;
}

interface RoomData {
  roomId: string;
  name: string;
  hostUid: string;
  players: RoomPlayer[];
  maxPlayers: 2;
  status: 'waiting' | 'ready' | 'playing' | 'completed';
  gameId?: string;
  createdAt: number;
  isPrivate: boolean;
  password?: string;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

// Create Room Payload
interface CreateRoomPayload {
  name?: string;
  isPrivate?: boolean;
  password?: string;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

// Join Room Payload
interface JoinRoomPayload {
  roomId: string;
  password?: string;
}

// Set Ready Payload
interface SetReadyPayload {
  isReady: boolean;
}
```
