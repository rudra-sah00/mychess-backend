import { gameManager } from "../chess/GameManager";
import { firebaseAdmin } from "../firebase/firebaseAdmin";
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
  private db = firebaseAdmin.getDatabase();
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
    this.queue.set(uid, queuedPlayer);

    await this.db.ref(`matchmaking/queue/${uid}`).set(queuedPlayer);

    logger.info(`Player ${uid} joined matchmaking queue (rating: ${queuedPlayer.rating})`);

    await this.tryMatchmaking(uid);

    return { success: true };
  }

  async leaveQueue(uid: string): Promise<{ success: boolean }> {
    if (!this.queue.has(uid)) {
      return { success: false };
    }

    this.queue.delete(uid);
    await this.db.ref(`matchmaking/queue/${uid}`).remove();

    logger.info(`Player ${uid} left matchmaking queue`);
    return { success: true };
  }

  private async tryMatchmaking(uid: string): Promise<void> {
    const player = this.queue.get(uid);
    if (!player) {
      return;
    }

    let bestMatch: QueuedPlayer | null = null;
    let bestRatingDiff = Infinity;

    for (const [opponentUid, opponent] of this.queue) {
      if (opponentUid === uid) {
        continue;
      }

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
    await Promise.all([
      this.db.ref(`matchmaking/queue/${player1.uid}`).remove(),
      this.db.ref(`matchmaking/queue/${player2.uid}`).remove(),
    ]);

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

    await this.db.ref(`matchmaking/matches/${game.gameId}`).set({
      gameId: game.gameId,
      whitePlayer: { uid: whitePlayer.uid, rating: whitePlayer.rating },
      blackPlayer: { uid: blackPlayer.uid, rating: blackPlayer.rating },
      createdAt: game.createdAt,
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
