# Quick Start: Room-Based Chess

## Play with a Friend (Private Room)

### Player 1 (Host)

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8080/chess', {
  withCredentials: true
});

// 1. Create a private room
socket.emit('create-room', {
  name: 'Game with Friend',
  isPrivate: true,
  password: 'secret123',
  timeControl: {
    initialTimeMs: 300000,  // 5 minutes
    incrementMs: 3000       // 3 seconds
  }
}, (response) => {
  if (response.success) {
    console.log('Room ID:', response.room.roomId);
    console.log('Password:', 'secret123');
    // Share these with your friend!
  }
});

// 2. Wait for friend to join
socket.on('player-joined-room', (data) => {
  console.log('Friend joined!');
  // Show "Ready" button
});

// 3. Listen for ready changes
socket.on('player-ready-changed', (data) => {
  console.log(data.uid, 'is ready:', data.isReady);
});

// 4. Ready up when both players are in
function readyUp() {
  socket.emit('set-ready', { isReady: true });
}

// 5. Game starts automatically when both ready
socket.on('game-starting', (data) => {
  console.log('Game starting!');
  socket.emit('join-game', { gameId: data.gameId });
  // Navigate to game board
});
```

### Player 2 (Friend)

```typescript
// 1. Get room ID and password from friend
const roomId = 'abc12345';
const password = 'secret123';

// 2. Join the private room
socket.emit('join-room', {
  roomId,
  password
}, (response) => {
  if (response.success) {
    console.log('Joined room!');
  } else {
    console.error('Error:', response.error);
  }
});

// 3. Ready up
socket.on('player-ready-changed', (data) => {
  console.log('Friend ready status:', data.isReady);
});

socket.emit('set-ready', { isReady: true });

// 4. Wait for game to start
socket.on('game-starting', (data) => {
  socket.emit('join-game', { gameId: data.gameId });
});
```

---

## Find a Random Opponent (Public Room)

### Option 1: Browse Existing Rooms

```typescript
// List all available public rooms
socket.emit('list-rooms', (response) => {
  if (response.success) {
    const rooms = response.rooms;
    
    if (rooms.length > 0) {
      // Join first available room
      const room = rooms[0];
      socket.emit('join-room', {
        roomId: room.roomId
      }, (joinResponse) => {
        if (joinResponse.success) {
          console.log('Joined room:', room.name);
          // Ready up
          socket.emit('set-ready', { isReady: true });
        }
      });
    } else {
      console.log('No rooms available, create one!');
    }
  }
});
```

### Option 2: Create a Public Room

```typescript
// Create a public room (no password)
socket.emit('create-room', {
  name: 'Quick Game',
  isPrivate: false,  // Public room
  timeControl: {
    initialTimeMs: 180000,  // 3 minutes
    incrementMs: 2000       // 2 seconds
  }
}, (response) => {
  if (response.success) {
    console.log('Public room created:', response.room.roomId);
    console.log('Waiting for opponent...');
  }
});

// Wait for someone to join
socket.on('player-joined-room', (data) => {
  console.log('Opponent found!');
  socket.emit('set-ready', { isReady: true });
});

socket.on('game-starting', (data) => {
  socket.emit('join-game', { gameId: data.gameId });
});
```

---

## Key Points

### Public vs Private Rooms

| Feature | Public Room | Private Room |
|---------|-------------|--------------|
| **Password** | No | Yes (required) |
| **Discoverable** | Yes (`list-rooms`) | No |
| **Use Case** | Random opponents | Friends only |
| **Join Method** | Browse or direct link | Direct link + password |

### Creating a Room

```typescript
socket.emit('create-room', {
  name?: 'Room Name',        // Optional custom name
  isPrivate?: false,         // true = private, false/undefined = public
  password?: 'secret',       // Required if isPrivate = true
  timeControl?: {            // Optional time control
    initialTimeMs: 300000,
    incrementMs: 3000
  }
}, callback);
```

### Joining a Room

```typescript
// Public room (no password)
socket.emit('join-room', {
  roomId: 'abc12345'
}, callback);

// Private room (with password)
socket.emit('join-room', {
  roomId: 'xyz98765',
  password: 'secret123'
}, callback);
```

### Ready System

Both players must ready up before game starts:

```typescript
// Ready up
socket.emit('set-ready', { isReady: true });

// Un-ready (if needed)
socket.emit('set-ready', { isReady: false });

// When both ready, server automatically:
// 1. Creates the game
// 2. Emits 'game-starting' to both players
// 3. Players join game and start playing
```

---

## Complete Frontend Example

```typescript
import { io } from 'socket.io-client';

class ChessRoom {
  socket: any;
  currentRoom: any = null;

  constructor() {
    this.socket = io('http://localhost:8080/chess', {
      withCredentials: true
    });
    
    this.setupListeners();
  }

  setupListeners() {
    this.socket.on('player-joined-room', (data) => {
      this.onPlayerJoined(data);
    });
    
    this.socket.on('player-left-room', (data) => {
      this.onPlayerLeft(data);
    });
    
    this.socket.on('player-ready-changed', (data) => {
      this.onPlayerReadyChanged(data);
    });
    
    this.socket.on('game-starting', (data) => {
      this.onGameStarting(data);
    });
    
    this.socket.on('room-disbanded', (data) => {
      this.onRoomDisbanded(data);
    });
  }

  // Create a public room
  createPublicRoom(name: string, timeControl?: any) {
    this.socket.emit('create-room', {
      name,
      isPrivate: false,
      timeControl
    }, (response) => {
      if (response.success) {
        this.currentRoom = response.room;
        this.showRoomLobby();
      } else {
        alert('Failed to create room: ' + response.error);
      }
    });
  }

  // Create a private room
  createPrivateRoom(name: string, password: string, timeControl?: any) {
    this.socket.emit('create-room', {
      name,
      isPrivate: true,
      password,
      timeControl
    }, (response) => {
      if (response.success) {
        this.currentRoom = response.room;
        this.showRoomLobby();
        this.showShareInfo(response.room.roomId, password);
      } else {
        alert('Failed to create room: ' + response.error);
      }
    });
  }

  // Join a room
  joinRoom(roomId: string, password?: string) {
    this.socket.emit('join-room', {
      roomId,
      password
    }, (response) => {
      if (response.success) {
        this.currentRoom = response.room;
        this.showRoomLobby();
      } else {
        alert('Failed to join: ' + response.error);
      }
    });
  }

  // List available rooms
  listRooms() {
    this.socket.emit('list-rooms', (response) => {
      if (response.success) {
        this.showRoomList(response.rooms);
      }
    });
  }

  // Ready up
  setReady(isReady: boolean) {
    this.socket.emit('set-ready', { isReady }, (response) => {
      if (response.success) {
        console.log('Ready status updated');
      }
    });
  }

  // Leave room
  leaveRoom() {
    this.socket.emit('leave-room', (response) => {
      if (response.success) {
        this.currentRoom = null;
        this.showLobby();
      }
    });
  }

  // Event handlers
  onPlayerJoined(data: any) {
    console.log('Player joined:', data.player.uid);
    this.currentRoom = data.room;
    this.updateRoomDisplay();
  }

  onPlayerLeft(data: any) {
    console.log('Player left:', data.uid);
    this.currentRoom = data.room;
    this.updateRoomDisplay();
  }

  onPlayerReadyChanged(data: any) {
    console.log('Ready changed:', data.uid, data.isReady);
    this.currentRoom = data.room;
    this.updateRoomDisplay();
  }

  onGameStarting(data: any) {
    console.log('Game starting:', data.gameId);
    // Join the game
    this.socket.emit('join-game', { gameId: data.gameId });
    // Navigate to game board
    this.navigateToGame(data.gameId);
  }

  onRoomDisbanded(data: any) {
    alert('Room was disbanded');
    this.currentRoom = null;
    this.showLobby();
  }

  // UI methods (implement based on your frontend framework)
  showRoomLobby() { /* Show room lobby UI */ }
  showRoomList(rooms: any[]) { /* Show list of rooms */ }
  showLobby() { /* Show main lobby */ }
  showShareInfo(roomId: string, password: string) { /* Show room ID/password to share */ }
  updateRoomDisplay() { /* Update room UI with current room data */ }
  navigateToGame(gameId: string) { /* Navigate to game board */ }
}

// Usage
const chessRoom = new ChessRoom();

// Create public room
chessRoom.createPublicRoom('Quick Blitz', {
  initialTimeMs: 180000,
  incrementMs: 2000
});

// Create private room
chessRoom.createPrivateRoom('Game with Bob', 'password123', {
  initialTimeMs: 300000,
  incrementMs: 3000
});

// Join room
chessRoom.joinRoom('abc12345', 'password123');

// List rooms
chessRoom.listRooms();
```

---

## Next Steps

- See full API reference: `/docs/api/room-events.md`
- See complete guide: `/docs/guides/room-system.md`
- See game events: `/docs/api/chess-events.md`
