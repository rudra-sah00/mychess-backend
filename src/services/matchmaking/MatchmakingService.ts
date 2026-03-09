import { gameManager } from "../chess/GameManager";
import redisClient from "../redis/redisClient";
import logger from "../../config/logger";

interface MatchmakingRequest {
  uid: string;
  socketId: string;
  rating?: number;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
  requestedAt: number;
}

interface QueuedPlayer {
  uid: string;
  socketId: string;
  rating: number;
  timeControl: {
    initialTimeMs: number;
    incrementMs: number;
  };
  requestedAt: number;
}

export class MatchmakingService {
  private queue: Map<string, QueuedPlayer> = new Map();
  private matchFoundCallback?: (player1Uid: string, player2Uid: string, gameId: string) => void;
  private readonly DEFAULT_RATING = 1500;
  private readonly RATING_RANGE = 200;
  private readonly DEFAULT_TIME_CONTROL = {
    initialTimeMs: 10 * 60 * 1000, // 10 minutes
    incrementMs: 0,
  };

  setMatchFoundCallback(callback: (player1Uid: string, player2Uid: string, gameId: string) => void): void {
    this.matchFoundCallback = callback;
  }

  async joinQueue(request: MatchmakingRequest): Promise<{ success: boolean; error?: string }> {
    const { uid, socketId, rating, timeControl } = request;

    if (this.queue.has(uid)) {
      logger.warn(`Player ${uid} already in matchmaking queue`);
      return { success: false, error: "Already in queue" };
    }

    const queuedPlayer: QueuedPlayer = {
      uid,
      socketId,
      rating: rating || this.DEFAULT_RATING,
      timeControl: timeControl || this.DEFAULT_TIME_CONTROL,
      requestedAt: Date.now(),
    };

    // Local state for fast lookup (could be entirely moved to redis, but kept for simplicity if single instance)
    this.queue.set(uid, queuedPlayer);

    // Redis: Store in a sorted set bounded by rating
    await redisClient.zAdd("matchmaking:queue", {
      score: queuedPlayer.rating,
      value: uid
    });
    // Store player details in a hash
    await redisClient.hSet(`matchmaking:player:${uid}`, {
      socketId: queuedPlayer.socketId,
      rating: queuedPlayer.rating.toString(),
      initialTimeMs: queuedPlayer.timeControl.initialTimeMs.toString(),
      incrementMs: queuedPlayer.timeControl.incrementMs.toString(),
      requestedAt: queuedPlayer.requestedAt.toString()
    });

    logger.info(`Player ${uid} joined matchmaking queue (rating: ${queuedPlayer.rating})`);

    // Asynchronously try to find a match
    this.tryMatchmaking(uid).catch(err => logger.error("Matchmaking error", err));

    return { success: true };
  }

  async leaveQueue(uid: string): Promise<{ success: boolean }> {
    if (!this.queue.has(uid)) {
      return { success: false };
    }

    this.queue.delete(uid);
    await redisClient.zRem("matchmaking:queue", uid);
    await redisClient.del(`matchmaking:player:${uid}`);

    logger.info(`Player ${uid} left matchmaking queue`);
    return { success: true };
  }

  private async tryMatchmaking(uid: string): Promise<void> {
    const player = this.queue.get(uid);
    if (!player) return;

    // Look for opponents in redis within rating range
    const minRating = player.rating - this.RATING_RANGE;
    const maxRating = player.rating + this.RATING_RANGE;

    const potentialOpponents = await redisClient.zRangeByScore("matchmaking:queue", minRating, maxRating);

    let bestMatch: QueuedPlayer | null = null;
    let bestRatingDiff = Infinity;

    for (const opponentUid of potentialOpponents) {
      if (opponentUid === uid) continue;

      const opponentData = await redisClient.hGetAll(`matchmaking:player:${opponentUid}`);
      if (!opponentData || Object.keys(opponentData).length === 0) continue;

      const opponent: QueuedPlayer = {
        uid: opponentUid,
        socketId: opponentData.socketId,
        rating: parseInt(opponentData.rating, 10),
        timeControl: {
          initialTimeMs: parseInt(opponentData.initialTimeMs, 10),
          incrementMs: parseInt(opponentData.incrementMs, 10),
        },
        requestedAt: parseInt(opponentData.requestedAt, 10)
      };

      if (
        opponent.timeControl.initialTimeMs !== player.timeControl.initialTimeMs ||
        opponent.timeControl.incrementMs !== player.timeControl.incrementMs
      ) {
        continue;
      }

      const ratingDiff = Math.abs(opponent.rating - player.rating);
      if (ratingDiff <= this.RATING_RANGE && ratingDiff < bestRatingDiff) {
        bestMatch = opponent;
        bestRatingDiff = ratingDiff;
      }
    }

    if (bestMatch) {
      await this.createMatch(player, bestMatch);
    }
  }

  private async createMatch(player1: QueuedPlayer, player2: QueuedPlayer): Promise<void> {
    this.queue.delete(player1.uid);
    this.queue.delete(player2.uid);

    await redisClient.zRem("matchmaking:queue", [player1.uid, player2.uid]);
    await redisClient.del([`matchmaking:player:${player1.uid}`, `matchmaking:player:${player2.uid}`]);

    const whitePlayer = Math.random() < 0.5 ? player1 : player2;
    const blackPlayer = whitePlayer === player1 ? player2 : player1;

    const game = await gameManager.createGame(
      whitePlayer.uid,
      blackPlayer.uid,
      whitePlayer.socketId,
      blackPlayer.socketId,
      player1.timeControl
    );

    logger.info(
      `Match created: ${game.gameId} (${whitePlayer.uid} vs ${blackPlayer.uid}, ratings: ${whitePlayer.rating} vs ${blackPlayer.rating})`
    );

    await redisClient.hSet(`matchmaking:matches:${game.gameId}`, {
      gameId: game.gameId,
      whitePlayerUid: whitePlayer.uid,
      whitePlayerRating: whitePlayer.rating.toString(),
      blackPlayerUid: blackPlayer.uid,
      blackPlayerRating: blackPlayer.rating.toString(),
      createdAt: game.createdAt.toString(),
    });

    if (this.matchFoundCallback) {
      this.matchFoundCallback(player1.uid, player2.uid, game.gameId);
    }
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  getPlayerPosition(uid: string): number | null {
    if (!this.queue.has(uid)) {
      return null;
    }

    const player = this.queue.get(uid)!;
    let position = 1;

    for (const [, queuedPlayer] of this.queue) {
      if (queuedPlayer.requestedAt < player.requestedAt) {
        position++;
      }
    }

    return position;
  }
}

export const matchmakingService = new MatchmakingService();

export default MatchmakingService;
