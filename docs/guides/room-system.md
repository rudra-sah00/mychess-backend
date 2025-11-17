# Room System Guide

## Overview

The room system provides a lobby-based matchmaking experience where players can create and join rooms before starting a chess game. This is an alternative to the automatic matchmaking queue.

## Key Features

### Public Rooms
- **Anyone can join** with just the room ID
- **Discoverable** via `list-rooms` event
- Perfect for casual games and open challenges
- No password required

### Private Rooms
- **Password-protected** rooms
- **Not discoverable** in public room listings
- Perfect for playing with friends
- Host shares room ID + password privately

### Room Capacity
- **Exactly 2 players** per room
- Host (creator) + 1 joiner
- When 2 players join, room status becomes "ready"

### Ready System
- Both players must **mark themselves as ready**
- When all players ready → game **starts automatically**
- Players can **toggle ready status** before game starts

### Time Controls (Optional)
- Set custom time controls when creating room
- Applies to the game when it starts
- Examples: Bullet (1+0), Blitz (3+2), Rapid (10+5)

## Room vs Matchmaking

| Feature | Room System | Matchmaking Queue |
|---------|-------------|-------------------|
| **Control** | Host controls room | Automatic pairing |
| **Friends** | Easy to play with friends | Random opponents |
| **Privacy** | Can be private | Always public |
| **Discovery** | Browse room list | No browsing |
| **Time Control** | Custom per room | Fixed/preset |
| **Start Time** | When both ready | Immediate on match |

**Use Rooms When:**
- Playing with specific friends
- Want custom time controls
- Want to wait in a lobby
- Running a tournament/event

**Use Matchmaking When:**
- Want instant opponent
- Don't care who you play
- Want fastest game start

## Architecture

### Data Flow

```
Player 1: create-room
    ↓
Room Created (status: waiting)
    ↓
Player 2: join-room
    ↓
Room Full (status: ready)
    ↓
Player 1: set-ready (isReady: true)
Player 2: set-ready (isReady: true)
    ↓
All Ready Detected
    ↓
Game Created Automatically
    ↓
game-starting event → Both players
    ↓
Players: join-game
    ↓
Game Begins
```

### Room Status States

```typescript
type RoomStatus = 'waiting' | 'ready' | 'playing' | 'completed';
```

- **waiting**: 1 player, waiting for 2nd player
- **ready**: 2 players, waiting for ready-up
- **playing**: Game in progress
- **completed**: Game finished

### Automatic Cleanup

- **On disconnect**: Player automatically removed from room
- **Host leaves**: Room disbanded, all players kicked
- **Last player leaves**: Room disbanded
- **Stale rooms**: Rooms older than 1 hour (not playing) are cleaned up

## Implementation Examples

### Frontend: Create Public Room

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8080/chess', {
  withCredentials: true
});

// Create a public room
function createPublicRoom() {
  socket.emit('create-room', {
    name: 'Casual Blitz Game',
    timeControl: {
      initialTimeMs: 300000,  // 5 minutes
      incrementMs: 0
    }
  }, (response) => {
    if (response.success) {
      const room = response.room;
      console.log('Room created!');
      console.log('Room ID:', room.roomId);
      console.log('Share this ID with your opponent');
      
      // Show room lobby UI
      showRoomLobby(room);
    } else {
      alert('Failed to create room: ' + response.error);
    }
  });
}

function showRoomLobby(room) {
  // Display room info
  document.getElementById('room-id').textContent = room.roomId;
  document.getElementById('room-name').textContent = room.name;
  
  // Show players
  updatePlayerList(room.players);
  
  // Listen for other player joining
  socket.on('player-joined-room', (data) => {
    console.log('Player joined!');
    updatePlayerList(data.room.players);
    
    // Enable ready button
    document.getElementById('ready-btn').disabled = false;
  });
  
  // Listen for ready changes
  socket.on('player-ready-changed', (data) => {
    updatePlayerList(data.room.players);
  });
  
  // Listen for game start
  socket.on('game-starting', (data) => {
    console.log('Game starting!');
    navigateToGame(data.gameId);
  });
}

function readyUp() {
  socket.emit('set-ready', { isReady: true }, (response) => {
    if (response.success) {
      console.log('You are ready!');
      if (response.allReady) {
        console.log('Starting game...');
      }
    }
  });
}

function updatePlayerList(players) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  
  players.forEach(player => {
    const item = document.createElement('div');
    item.textContent = player.uid;
    
    if (player.isReady) {
      item.classList.add('ready');
      item.textContent += ' ✓';
    }
    
    list.appendChild(item);
  });
}
```

### Frontend: Create Private Room

```typescript
function createPrivateRoom() {
  const password = prompt('Enter a password for this private room:');
  
  if (!password) {
    alert('Password is required for private rooms');
    return;
  }
  
  socket.emit('create-room', {
    name: 'Private Game',
    isPrivate: true,
    password: password
  }, (response) => {
    if (response.success) {
      const room = response.room;
      
      // Show room ID and password to share
      const shareMessage = `
        Room ID: ${room.roomId}
        Password: ${password}
        
        Share these with your friend to join!
      `;
      
      alert(shareMessage);
      showRoomLobby(room);
    }
  });
}
```

### Frontend: Join Room (Public or Private)

```typescript
function joinRoom() {
  const roomId = document.getElementById('room-id-input').value;
  const password = document.getElementById('password-input').value || undefined;
  
  socket.emit('join-room', {
    roomId,
    password
  }, (response) => {
    if (response.success) {
      console.log('Joined room!');
      showRoomLobby(response.room);
    } else {
      // Handle errors
      switch (response.error) {
        case 'Room not found':
          alert('Room does not exist');
          break;
        case 'Invalid password':
          alert('Incorrect password');
          break;
        case 'Room is full':
          alert('Room is full (2 players max)');
          break;
        default:
          alert('Failed to join: ' + response.error);
      }
    }
  });
}
```

### Frontend: Browse Public Rooms

```typescript
function browseRooms() {
  socket.emit('list-rooms', (response) => {
    if (response.success) {
      const rooms = response.rooms;
      
      if (rooms.length === 0) {
        console.log('No rooms available. Create one!');
        return;
      }
      
      // Display room list
      const roomList = document.getElementById('room-list');
      roomList.innerHTML = '';
      
      rooms.forEach(room => {
        const roomCard = document.createElement('div');
        roomCard.className = 'room-card';
        roomCard.innerHTML = `
          <h3>${room.name}</h3>
          <p>Players: ${room.players.length}/${room.maxPlayers}</p>
          <p>Host: ${room.hostUid}</p>
          ${room.timeControl ? `
            <p>Time: ${room.timeControl.initialTimeMs / 60000}+${room.timeControl.incrementMs / 1000}</p>
          ` : ''}
          <button onclick="quickJoin('${room.roomId}')">Join</button>
        `;
        
        roomList.appendChild(roomCard);
      });
    }
  });
}

function quickJoin(roomId) {
  socket.emit('join-room', { roomId }, (response) => {
    if (response.success) {
      showRoomLobby(response.room);
    } else {
      alert('Failed to join: ' + response.error);
      // Refresh room list
      browseRooms();
    }
  });
}
```

### Frontend: Leave Room

```typescript
function leaveRoom() {
  socket.emit('leave-room', (response) => {
    if (response.success) {
      console.log('Left room');
      
      if (response.disbanded) {
        console.log('Room was disbanded');
      }
      
      // Navigate back to lobby
      navigateToLobby();
    }
  });
}

// Handle room disbanded by host
socket.on('room-disbanded', (data) => {
  alert('Room was disbanded by host');
  navigateToLobby();
});

// Handle other player leaving
socket.on('player-left-room', (data) => {
  console.log('Player left:', data.uid);
  updatePlayerList(data.room.players);
});
```

## UI Recommendations

### Room Lobby Screen

```
┌─────────────────────────────────────┐
│  Room: Casual Blitz Game            │
│  Room ID: abc12345                  │
│  Status: Ready (2/2 players)        │
├─────────────────────────────────────┤
│  Players:                           │
│  ✓ Player1 (Host) [READY]          │
│  ✓ Player2 [READY]                 │
├─────────────────────────────────────┤
│  Time Control: 5+0 Blitz           │
├─────────────────────────────────────┤
│  [Toggle Ready] [Leave Room]       │
└─────────────────────────────────────┘
```

### Public Room Browser

```
┌─────────────────────────────────────┐
│  Available Rooms                    │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐ │
│  │ Quick Game         (1/2)      │ │
│  │ Time: 3+2                     │ │
│  │ [Join]                        │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Beginner Friendly  (1/2)      │ │
│  │ Time: 10+5                    │ │
│  │ [Join]                        │ │
│  └───────────────────────────────┘ │
│                                     │
│  [Create Room] [Refresh]            │
└─────────────────────────────────────┘
```

### Private Room Join Dialog

```
┌─────────────────────────────────────┐
│  Join Private Room                  │
├─────────────────────────────────────┤
│  Room ID:                           │
│  [_________________________]        │
│                                     │
│  Password:                          │
│  [_________________________]        │
│                                     │
│  [Join Room] [Cancel]              │
└─────────────────────────────────────┘
```

## Security Considerations

1. **Passwords**: Stored in plain text (fine for casual use). For production, consider hashing.
2. **Room Discovery**: Private rooms are hidden from `list-rooms`
3. **Player Verification**: Socket authentication ensures valid users
4. **Rate Limiting**: Consider adding rate limits for room creation
5. **Room Bombing**: Consider max rooms per user

## Database Schema

Rooms are stored in Firebase Realtime Database:

```json
{
  "rooms": {
    "abc12345": {
      "roomId": "abc12345",
      "name": "Casual Game",
      "hostUid": "user-123",
      "players": [
        { "uid": "user-123", "joinedAt": 1731700000000, "isReady": false },
        { "uid": "user-456", "joinedAt": 1731700005000, "isReady": true }
      ],
      "maxPlayers": 2,
      "status": "ready",
      "isPrivate": false,
      "createdAt": 1731700000000,
      "timeControl": {
        "initialTimeMs": 300000,
        "incrementMs": 3000
      }
    }
  }
}
```

## Testing

See `src/services/room/__tests__/RoomService.test.ts` for comprehensive test coverage:

- ✅ Create public/private rooms
- ✅ Join rooms with/without password
- ✅ Leave rooms and disbanding
- ✅ Ready system and all-ready detection
- ✅ Room listing (public only)
- ✅ Error handling

Run tests:
```bash
npm test -- RoomService.test.ts
```

## Troubleshooting

### "Already in a room"
**Cause**: Player is already in another room  
**Fix**: Leave current room before joining/creating new one

### "Invalid password"
**Cause**: Wrong password for private room  
**Fix**: Get correct password from room host

### "Room is full"
**Cause**: Room already has 2 players  
**Fix**: Join a different room or wait for player to leave

### "Room not found"
**Cause**: Room disbanded or invalid ID  
**Fix**: Refresh room list, get new room ID

### Game doesn't start
**Cause**: Not all players are ready  
**Fix**: Ensure both players click "Ready"
