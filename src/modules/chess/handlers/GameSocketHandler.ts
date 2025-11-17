import { Socket, Namespace } from "socket.io";
import { gameManager } from "../../../services/chess/GameManager";
import logger from "../../../config/logger";
import { JoinGamePayload, MakeMovePayload, ResignPayload, DrawOfferPayload, DrawResponsePayload } from "../types";

/**
 * Handles game-related socket events (join, move, resign, draw)
 */
export class GameSocketHandler {
  constructor(
    private readonly chessNs: Namespace
  ) {}

  /**
   * Register all game-related event handlers for a socket
   */
  registerHandlers(socket: Socket, uid: string, username: string): void {
    this.handleJoinGame(socket, uid);
    this.handleMakeMove(socket, uid);
    this.handleResign(socket, uid);
    this.handleDrawOffer(socket, uid);
    this.handleDrawResponse(socket, uid);
  }

  /**
   * Handle join-game event
   */
  private handleJoinGame(socket: Socket, uid: string): void {
    socket.on("join-game", async (payload: JoinGamePayload, callback?: (response: any) => void) => {
      try {
        const { gameId } = payload;
        logger.info(`Player ${uid} attempting to join game ${gameId}`);

        const game = gameManager.getGame(gameId);
        if (!game) {
          callback?.({ success: false, error: "Game not found" });
          return;
        }

        // Determine player's color
        const isWhite = game.whitePlayer.uid === uid;
        const isBlack = game.blackPlayer.uid === uid;

        if (!isWhite && !isBlack) {
          callback?.({ success: false, error: "You are not part of this game" });
          return;
        }

        const playerColor = isWhite ? "white" : "black";

        // Update socket ID for reconnection handling
        await gameManager.updateSocketId(gameId, uid, socket.id);

        // Join the Socket.IO room
        socket.join(gameId);

        logger.info(`Player ${uid} (${playerColor}) joined game ${gameId}`);

        // Send game state to the player
        callback?.({
          success: true,
          game: {
            gameId,
            fen: game.fen,
            pgn: game.pgn,
            turn: game.turn,
            status: game.status,
            whitePlayer: game.whitePlayer,
            blackPlayer: game.blackPlayer,
            winner: game.winner,
            endReason: game.endReason,
            clockState: game.clockState,
            playerColor,
            drawOffer: game.drawOffer,
          },
        });
      } catch (error) {
        logger.error(`Join game error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to join game" });
      }
    });
  }

  /**
   * Handle make-move event
   */
  private handleMakeMove(socket: Socket, uid: string): void {
    socket.on("make-move", async (payload: MakeMovePayload, callback?: (response: any) => void) => {
      try {
        const { gameId, from, to, promotion } = payload;
        logger.debug(`Move attempt by ${uid} in game ${gameId}: ${from} -> ${to}`);

        const result = await gameManager.applyMove(gameId, uid, from, to, promotion);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        callback?.({ success: true, move: result.move });

        // Broadcast move to all players in the game
        const game = gameManager.getGame(gameId);
        socket.to(gameId).emit("move-made", {
          gameId,
          move: result.move,
          fen: game?.fen,
          pgn: game?.pgn,
          turn: game?.turn,
          clockState: game?.clockState,
        });

        // If game is over, broadcast game-over event
        if (result.isGameOver) {
          this.chessNs.to(gameId).emit("game-over", {
            winner: result.winner,
            reason: result.reason,
            finalFen: game?.fen,
            pgn: game?.pgn,
          });
          logger.info(`Game ${gameId} ended: ${result.reason}`);
        }

        logger.info(`Move made in game ${gameId} by ${uid}: ${from} -> ${to}`);
      } catch (error) {
        logger.error(`Make move error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to make move" });
      }
    });
  }

  /**
   * Handle resign event
   */
  private handleResign(socket: Socket, uid: string): void {
    socket.on("resign", async (payload: ResignPayload, callback?: (response: any) => void) => {
      try {
        const { gameId } = payload;
        logger.info(`Player ${uid} attempting to resign in game ${gameId}`);

        const result = await gameManager.resign(gameId, uid);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        callback?.({ success: true });

        // Broadcast game over
        const game = gameManager.getGame(gameId);
        this.chessNs.to(gameId).emit("game-over", {
          winner: result.winner,
          reason: result.reason,
          finalFen: game?.fen,
          pgn: game?.pgn,
        });

        logger.info(`Game ${gameId} ended by resignation from ${uid}`);
      } catch (error) {
        logger.error(`Resign error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to resign" });
      }
    });
  }

  /**
   * Handle draw offer event
   */
  private handleDrawOffer(socket: Socket, uid: string): void {
    socket.on("offer-draw", async (payload: DrawOfferPayload, callback?: (response: any) => void) => {
      try {
        const { gameId } = payload;

        const result = await gameManager.offerDraw(gameId, uid);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        callback?.({ success: true });

        // Notify opponent
        socket.to(gameId).emit("draw-offered", {
          from: uid,
        });

        logger.info(`Draw offered by ${uid} in game ${gameId}`);
      } catch (error) {
        logger.error(`Offer draw error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to offer draw" });
      }
    });
  }

  /**
   * Handle draw response event
   */
  private handleDrawResponse(socket: Socket, uid: string): void {
    socket.on("draw-response", async (payload: DrawResponsePayload, callback?: (response: any) => void) => {
      try {
        const { gameId, accept } = payload;

        const result = await gameManager.respondToDrawOffer(gameId, uid, accept);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        callback?.({ success: true });

        if (accept && "isGameOver" in result && result.isGameOver) {
          // Broadcast game over
          const game = gameManager.getGame(gameId);
          this.chessNs.to(gameId).emit("game-over", {
            winner: result.winner,
            reason: result.reason,
            finalFen: game?.fen,
            pgn: game?.pgn,
          });
          logger.info(`Game ${gameId} ended by draw agreement`);
        } else {
          // Notify draw declined
          socket.to(gameId).emit("draw-declined", {});
          logger.info(`Draw declined by ${uid} in game ${gameId}`);
        }
      } catch (error) {
        logger.error(`Draw response error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to respond to draw offer" });
      }
    });
  }
}
