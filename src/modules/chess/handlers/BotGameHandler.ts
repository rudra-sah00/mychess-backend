import { Socket, Namespace } from "socket.io";
import { BotManager, BotDifficulty } from "../../../services/bot/BotService";
import { gameManager } from "../../../services/chess/GameManager";
import logger from "../../../config/logger";
import { PlayWithBotPayload } from "../types";

/**
 * Handles bot game related socket events
 */
export class BotGameHandler {
  constructor(
    private readonly chessNs: Namespace,
    private readonly botManager: BotManager
  ) {}

  /**
   * Register bot game event handlers for a socket
   */
  registerHandlers(socket: Socket, uid: string, username: string): void {
    this.handlePlayWithBot(socket, uid, username);
  }

  /**
   * Handle play-with-bot event
   */
  private handlePlayWithBot(socket: Socket, uid: string, username: string): void {
    socket.on("play-with-bot", async (payload: PlayWithBotPayload, callback?: (response: any) => void) => {
      try {
        const { difficulty = "medium", playerColor = "random", timeControl } = payload;

        logger.info(`Player ${uid} requesting bot game with difficulty: ${difficulty}, color: ${playerColor}`);

        // Determine player color
        let actualPlayerColor: "white" | "black";
        if (playerColor === "random") {
          actualPlayerColor = Math.random() < 0.5 ? "white" : "black";
        } else {
          actualPlayerColor = playerColor;
        }

        const botColor = actualPlayerColor === "white" ? "black" : "white";

        // Create game with bot
        const gameData = actualPlayerColor === "white"
          ? await gameManager.createGame(
              uid, "BOT", socket.id, "BOT",
              timeControl, undefined, username, `Bot (${difficulty})`
            )
          : await gameManager.createGame(
              "BOT", uid, "BOT", socket.id,
              timeControl, undefined, `Bot (${difficulty})`, username
            );

        const gameId = gameData.gameId;

        // Join the game room
        socket.join(gameId);

        // Create and initialize bot
        const bot = await this.botManager.createBot(gameId, difficulty as BotDifficulty);

        const game = gameManager.getGame(gameId);

        callback?.({
          success: true,
          game: {
            gameId,
            fen: game?.fen,
            pgn: game?.pgn,
            turn: game?.turn,
            status: game?.status,
            whitePlayer: game?.whitePlayer,
            blackPlayer: game?.blackPlayer,
            clockState: game?.clockState,
            playerColor: actualPlayerColor,
          },
        });

        logger.info(`Bot game ${gameId} created for player ${uid}, player is ${actualPlayerColor}`);

        // If bot plays first, make the opening move
        if (botColor === "white") {
          setTimeout(async () => {
            await this.makeBotMove(gameId, game?.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
          }, 500);
        }
      } catch (error) {
        logger.error(`Play with bot error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to start bot game" });
      }
    });
  }

  /**
   * Make a bot move for a game
   */
  private async makeBotMove(gameId: string, fen: string): Promise<void> {
    try {
      const bot = this.botManager.getBot(gameId);
      if (!bot) {
        logger.error(`No bot found for game ${gameId}`);
        return;
      }

      // Get best move from bot
      const moveUci = await bot.getBestMove(fen);
      
      // Parse UCI move (e.g., "e2e4" or "e7e8q" for promotion)
      const from = moveUci.substring(0, 2);
      const to = moveUci.substring(2, 4);
      const promotion = moveUci.length > 4 ? moveUci[4] : undefined;

      // Apply the move
      const result = await gameManager.applyMove(gameId, "BOT", from, to, promotion);

      if (result.success) {
        const game = gameManager.getGame(gameId);
        
        // Broadcast bot's move to player
        this.chessNs.to(gameId).emit("move-made", {
          gameId,
          move: result.move,
          fen: game?.fen,
          pgn: game?.pgn,
          turn: game?.turn,
          clockState: game?.clockState,
        });

        // Check if game ended
        if (result.isGameOver) {
          this.chessNs.to(gameId).emit("game-over", {
            winner: result.winner,
            reason: result.reason,
            finalFen: game?.fen,
            pgn: game?.pgn,
          });
          this.botManager.removeBot(gameId);
          logger.info(`Bot game ${gameId} ended: ${result.reason}`);
        } else if (game?.turn === 'b' && game.blackPlayer.uid === 'BOT') {
          // If it's still bot's turn (e.g., after player move), make another move
          setTimeout(() => {
            this.makeBotMove(gameId, game.fen);
          }, 500);
        } else if (game?.turn === 'w' && game.whitePlayer.uid === 'BOT') {
          // If it's still bot's turn (e.g., after player move), make another move
          setTimeout(() => {
            this.makeBotMove(gameId, game.fen);
          }, 500);
        }
      }
    } catch (error) {
      logger.error(`Bot move error in game ${gameId}:`, error);
    }
  }

  /**
   * Clean up bot when player disconnects
   */
  cleanupBotGame(gameId: string): void {
    this.botManager.removeBot(gameId);
  }
}
