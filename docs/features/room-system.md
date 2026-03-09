# Room System

Feature-rich room management for custom games and friend challenges.

## State Management
Room states are stored in Redis for low-latency synchronization.
Standard rooms host 2 players and optional spectators.

## Workflow

1. **Create:** A player creates a room and receives a unique code.
2. **Join:** A second player joins using the code.
3. **Setup:** Players negotiate time controls, colors, and variant.
4. **Ready:** Both players must toggle 'Ready' to begin.
5. **Start:** Once both are ready, the server transitions the room to an active game state.

## Visibility
- **Public:** Listed in the "Lobby" for anyone to join.
- **Private:** Only accessible via direct code/link.

## Data Persistence
Inactive rooms (no players) are cleaned up from Redis within 1 hour.
Active game records are created in PostgreSQL only when the match begins.
