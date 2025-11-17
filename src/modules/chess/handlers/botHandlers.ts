import { Socket } from "socket.io";
import { gameManager } from "../../../services/chess/GameManager";
import { BotDifficulty } from "../../../services/bot/BotService";
import { botManager } from "../botManager";
import { gamePersistenceService } from "../../../services/firebase/GamePersistenceService";
import logger from "../../../config/logger";

interface PlayWithBotPayload {
  difficulty: BotDifficulty;
  playerColor?: 'white' | 'black' | 'random';
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export const registerBotHandlers = (socket: Socket, chessNs: any) => {
  const uid = socket.data.uid as string;
  const username = socket.data.username as string || 'Player';

  // Play with bot
  socket.on("play-with-bot", async (
    payload: PlayWithBotPayload,
    callback?: (response: { success: boolean; gameId?: string; color?: string; error?: string }) => void
  ) => {
    logger.info(`🤖 Received play-with-bot request from ${uid} (${username}) - difficulty: ${payload.difficulty}`);
    
    try {
      // Clear any existing active game for this user
      await gamePersistenceService.removeActiveGame(uid);
      logger.info(`Cleared active game for ${uid} before starting new bot game`);

      const { difficulty = 'medium', playerColor: requestedColor, timeControl } = payload;

      // Validate difficulty
      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        logger.warn(`Invalid difficulty: ${difficulty}`);
        callback?.({ success: false, error: 'Invalid difficulty level' });
        return;
      }

      // Determine player color
      let playerColor: 'white' | 'black';
      if (requestedColor === 'random' || !requestedColor) {
        playerColor = Math.random() < 0.5 ? 'white' : 'black';
      } else {
        playerColor = requestedColor as 'white' | 'black';
      }
      const botColor = playerColor === 'white' ? 'black' : 'white';

      logger.info(`Creating bot game: player=${playerColor}, bot=${botColor}`);

      // Create game with player and bot
      const game = await gameManager.createGame(
        playerColor === 'white' ? uid : 'BOT',
        playerColor === 'black' ? uid : 'BOT',
        playerColor === 'white' ? socket.id : 'BOT_SOCKET',
        playerColor === 'black' ? socket.id : 'BOT_SOCKET',
        timeControl,
        undefined, // no roomId for bot games
        playerColor === 'white' ? username : 'Bot',
        playerColor === 'black' ? username : 'Bot'
      );

      logger.info(`Bot game created: ${game.gameId}, initializing bot...`);

      // Create bot instance
      await botManager.createBot(game.gameId, difficulty);

      logger.info(`Bot initialized for game ${game.gameId}`);

      // Join the game room
      socket.join(game.gameId);

      // Send response with game details
      callback?.({
        success: true,
        gameId: game.gameId,
        color: playerColor,
      });

      logger.info(`Callback sent for game ${game.gameId}`);

      // Emit game-starting event
      socket.emit("game-starting", {
        gameId: game.gameId,
        whitePlayer: game.whitePlayer,
        blackPlayer: game.blackPlayer,
        playerColor,
        timeControl: game.clockConfig,
        fen: game.fen,
      });

      logger.info(`Bot game ${game.gameId} created: ${uid} (${playerColor}) vs Bot (${botColor}, ${difficulty})`);

      // If bot plays first (white), make initial move
      if (botColor === 'white') {
        setTimeout(async () => {
          await makeBotMove(game.gameId, chessNs);
        }, 1000);
      }
    } catch (error) {
      logger.error(`Play with bot error: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error(`Error stack: ${error instanceof Error ? error.stack : "No stack trace"}`);
      callback?.({ success: false, error: "Failed to create bot game" });
    }
  });
};

/**
 * Make a bot move for the given game
 */
export async function makeBotMove(gameId: string, chessNs: any): Promise<void> {
  try {
    const game = gameManager.getGame(gameId);
    if (!game) {
      logger.warn(`[Bot] Game ${gameId} not found`);
      return;
    }

    const bot = botManager.getBot(gameId);
    if (!bot) {
      logger.warn(`[Bot] No bot found for game ${gameId}`);
      return;
    }

    // Check if it's bot's turn
    const currentPlayer = game.turn === 'w' ? game.whitePlayer : game.blackPlayer;
    if (currentPlayer.uid !== 'BOT') {
      return; // Not bot's turn
    }

    logger.debug(`[Bot] Calculating move for game ${gameId}`);

    // Get best move from bot
    const moveStr = await bot.getBestMove(game.fen);
    
    // Parse move string (e.g., "e2e4" or "e7e8q")
    const from = moveStr.substring(0, 2);
    const to = moveStr.substring(2, 4);
    const promotion = moveStr.length > 4 ? moveStr[4] : undefined;

    logger.info(`[Bot] Making move in game ${gameId}: ${from} -> ${to}${promotion ? ` (${promotion})` : ''}`);

    // Apply the move
    const result = await gameManager.applyMove(gameId, currentPlayer.uid, from, to, promotion);

    if (!result.success) {
      logger.error(`[Bot] Failed to apply move in game ${gameId}: ${result.error}`);
      return;
    }

    // Get updated game state
    const updatedGame = gameManager.getGame(gameId);
    if (!updatedGame) return;

    // Emit move to all players in the game
    chessNs.to(gameId).emit("move-made", {
      gameId,
      move: result.move,
      fen: updatedGame.fen,
      currentTurn: updatedGame.turn === 'w' ? 'white' : 'black',
      gameStatus: updatedGame.status,
      isCheck: result.move?.san.includes('+') || false,
      isCheckmate: result.isGameOver && result.winner !== 'draw',
      isDraw: result.winner === 'draw',
    });

    logger.debug(`[Bot] Move applied successfully in game ${gameId}`);

    // If game is over, clean up bot
    if (updatedGame.status === 'completed') {
      botManager.removeBot(gameId);
    }
  } catch (error) {
    logger.error(`[Bot] Error making move in game ${gameId}:`, error);
  }
}
