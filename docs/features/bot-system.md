# Bot System

Integration of Stockfish chess engine for single-player games.

## Architecture

- **Engine:** Stockfish (WASM wrapper).
- **Service:** `BotService` handles engine lifecycle and move generation.
- **Manager:** `BotManager` manages instances to prevent memory leaks.

## Skill Levels
We support levels 1 through 20, mapping directly to Stockfish's "Skill Level" UCI option.
Wait times and depth are adjusted based on the requested level.

## Test Environment
To ensure fast and stable CI/CD, the `BotService` uses a mock implementation when `NODE_ENV === 'test'`.
The mock responds with 'uciok' and immediate valid moves without loading the full WASM engine.

## Lifecycle
1. `BotManager` initializes a `BotService` instance on game start.
2. The engine is initialized and set to the requested difficulty.
3. Moves are generated using `getBestMove(fen, difficulty)`.
4. Instance is terminated when the game ends or player leaves.
