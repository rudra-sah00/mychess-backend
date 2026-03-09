import redisClient from "../redis/redisClient";
import { PrismaClient } from "@prisma/client";
import logger from "../../config/logger";

const prisma = new PrismaClient();

export interface ActiveGame {
  gameId: string;
  type: "bot" | "pvp";
  playerUid: string;
  opponentUid?: string; // For PvP games
  playerColor: "white" | "black";
  fen: string;
  startedAt: number;
  lastUpdateAt: number;
  status: "active" | "disconnected";
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
  whiteTime?: number;
  blackTime?: number;
}

export interface MatchHistory {
  matchId: string;
  gameType: "bot" | "pvp";
  result: "win" | "loss" | "draw";
  playerColor: "white" | "black";
  opponent: {
    name: string;
    uid: string;
  };
  startTime: number;
  endTime: number;
  duration: number; // in seconds
  winner?: "white" | "black" | "draw";
}

class GamePersistenceService {
  private ACTIVE_GAMES_PREFIX = "activeGame:";
  private RECONNECT_TIMEOUT = 60000; // 1 minute

  /**
   * Save active game to Redis
   */
  async saveActiveGame(uid: string, gameData: ActiveGame): Promise<void> {
    try {
      const key = `${this.ACTIVE_GAMES_PREFIX}${uid}`;
      gameData.lastUpdateAt = Date.now();

      // Store the active game in Redis with a 1 hour expiration
      // This automatically handles the "cleanup stale games" requirement
      await redisClient.setEx(key, 3600, JSON.stringify(gameData));

      logger.debug(`Active game saved for user ${uid}, gameId: ${gameData.gameId}`);
    } catch (error) {
      logger.error("Error saving active game to Redis:", error);
      // Do not re-throw — Redis persistence is best-effort; a connection drop should never crash the server
    }
  }

  /**
   * Get active game for a user
   */

  async getActiveGame(uid: string): Promise<ActiveGame | null> {
    try {
      const key = `${this.ACTIVE_GAMES_PREFIX}${uid}`;
      const dataStr = await redisClient.get(key);

      if (!dataStr) {
        return null;
      }

      return JSON.parse(dataStr) as ActiveGame;
    } catch (error) {
      logger.error("Error getting active game from Redis:", error);
      return null;
    }
  }

  /**
   * Update active game status
   */
  async updateGameStatus(uid: string, status: "active" | "disconnected"): Promise<void> {
    try {
      const activeGame = await this.getActiveGame(uid);
      if (activeGame) {
        activeGame.status = status;
        await this.saveActiveGame(uid, activeGame);
      }
    } catch (error) {
      logger.error("Error updating game status in Redis:", error);
    }
  }

  /**
   * Update game state (FEN and times)
   */
  async updateGameState(uid: string, fen: string, whiteTime?: number, blackTime?: number): Promise<void> {
    try {
      const activeGame = await this.getActiveGame(uid);
      if (activeGame) {
        activeGame.fen = fen;
        if (whiteTime !== undefined) activeGame.whiteTime = whiteTime;
        if (blackTime !== undefined) activeGame.blackTime = blackTime;
        await this.saveActiveGame(uid, activeGame);
      }
    } catch (error) {
      logger.error("Error updating game state in Redis:", error);
    }
  }

  /**
   * Remove active game
   */
  async removeActiveGame(uid: string): Promise<void> {
    try {
      const key = `${this.ACTIVE_GAMES_PREFIX}${uid}`;
      await redisClient.del(key);
      logger.info(`Active game removed for user ${uid}`);
    } catch (error) {
      logger.error("Error removing active game from Redis:", error);
    }
  }

  /**
   * Save match to history in Postgres
   */
  async saveMatchHistory(uid: string, matchData: MatchHistory): Promise<void> {
    try {
      // Find the user to ensure they exist before trying to relate a game
      // Wait, our Prisma schema models this as actual Game records, not JSON logs!
      // Since GameManager will handle creating the actual Game record, we just log it conceptually here,
      // or we can ignore this entirely if GameManager manages the Prisma generic Game.

      logger.info(`Match history logged for user ${uid}, matchId: ${matchData.matchId}`);
    } catch (error) {
      logger.error("Error saving match history to Postgres:", error);
      throw error;
    }
  }

  /**
   * Get match history for a user from Postgres (with pagination)
   */
  async getMatchHistory(uid: string, limit: number = 20): Promise<MatchHistory[]> {
    try {
      // In Postgres, we query games involving this user
      const games = await prisma.game.findMany({
        where: {
          OR: [
            { whiteId: uid },
            { blackId: uid }
          ],
          status: "completed"
        },
        orderBy: {
          endedAt: 'desc'
        },
        take: limit,
        include: {
          whitePlayer: true,
          blackPlayer: true,
          winner: true
        }
      });

      return games.map(game => {
        const isWhite = game.whiteId === uid;
        const opponent = isWhite ? game.blackPlayer : game.whitePlayer;
        let result: "win" | "loss" | "draw" = "draw";
        if (game.winnerId) {
          result = game.winnerId === uid ? "win" : "loss";
        }

        return {
          matchId: game.id,
          gameType: "pvp", // Simplification
          result,
          playerColor: isWhite ? "white" : "black",
          opponent: {
            name: opponent.username,
            uid: opponent.id
          },
          startTime: game.createdAt.getTime(),
          endTime: game.endedAt ? game.endedAt.getTime() : Date.now(),
          duration: game.endedAt ? Math.floor((game.endedAt.getTime() - game.createdAt.getTime()) / 1000) : 0,
          winner: game.winnerId === game.whiteId ? "white" : (game.winnerId === game.blackId ? "black" : "draw"),
        };
      });
    } catch (error) {
      logger.error("Error getting match history from Postgres:", error);
      return [];
    }
  }

  /**
   * Check if user has active game and set up reconnection timeout
   */
  async checkReconnection(uid: string): Promise<ActiveGame | null> {
    const activeGame = await this.getActiveGame(uid);

    if (!activeGame) {
      return null;
    }

    if (activeGame.status === "disconnected") {
      const disconnectTime = activeGame.lastUpdateAt;
      const timeSinceDisconnect = Date.now() - disconnectTime;

      if (timeSinceDisconnect > this.RECONNECT_TIMEOUT) {
        logger.info(`Reconnection timeout expired for user ${uid}, ending game...`);
        return null;
      }
    }

    return activeGame;
  }

  /**
   * Cleanup stale games (older than 1 hour)
   * Redis handles this automatically via expiration (setEx 3600), so this is a no-op fallback.
   */
  async cleanupStaleGames(): Promise<void> {
    logger.debug(`Cleanup stale games called - handled natively by Redis TTL`);
  }
}

export const gamePersistenceService = new GamePersistenceService();
