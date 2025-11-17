import { getDatabase, getFirestore } from "../firebaseAdmin";
import logger from "../../config/logger";

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
  private db = getDatabase();
  private firestore = getFirestore();
  private ACTIVE_GAMES_PATH = "activeGames";
  private RECONNECT_TIMEOUT = 60000; // 1 minute

  /**
   * Save active game to RTDB
   */
  async saveActiveGame(uid: string, gameData: ActiveGame): Promise<void> {
    try {
      const ref = this.db.ref(`${this.ACTIVE_GAMES_PATH}/${uid}`);
      
      // Remove undefined values for Firebase compatibility
      const cleanData: any = {
        gameId: gameData.gameId,
        type: gameData.type,
        playerUid: gameData.playerUid,
        playerColor: gameData.playerColor,
        fen: gameData.fen,
        startedAt: gameData.startedAt,
        lastUpdateAt: Date.now(),
        status: gameData.status,
      };

      // Only add optional fields if they are defined
      if (gameData.opponentUid !== undefined) {
        cleanData.opponentUid = gameData.opponentUid;
      }
      if (gameData.timeControl !== undefined) {
        cleanData.timeControl = gameData.timeControl;
      }
      if (gameData.whiteTime !== undefined) {
        cleanData.whiteTime = gameData.whiteTime;
      }
      if (gameData.blackTime !== undefined) {
        cleanData.blackTime = gameData.blackTime;
      }

      await ref.set(cleanData);
      logger.info(`Active game saved for user ${uid}, gameId: ${gameData.gameId}`);
    } catch (error) {
      logger.error("Error saving active game:", error);
      throw error;
    }
  }

  /**
   * Get active game for a user
   */
  async getActiveGame(uid: string): Promise<ActiveGame | null> {
    try {
      const ref = this.db.ref(`${this.ACTIVE_GAMES_PATH}/${uid}`);
      const snapshot = await ref.once("value");
      const data = snapshot.val();
      
      if (!data) {
        return null;
      }

      // Check if game is too old (more than 1 hour)
      const oneHourAgo = Date.now() - 3600000;
      if (data.lastUpdateAt < oneHourAgo) {
        logger.info(`Active game for ${uid} is too old, removing...`);
        await this.removeActiveGame(uid);
        return null;
      }

      return data as ActiveGame;
    } catch (error) {
      logger.error("Error getting active game:", error);
      return null;
    }
  }

  /**
   * Update active game status
   */
  async updateGameStatus(uid: string, status: "active" | "disconnected"): Promise<void> {
    try {
      const ref = this.db.ref(`${this.ACTIVE_GAMES_PATH}/${uid}`);
      await ref.update({
        status,
        lastUpdateAt: Date.now(),
      });
    } catch (error) {
      logger.error("Error updating game status:", error);
    }
  }

  /**
   * Update game state (FEN and times)
   */
  async updateGameState(uid: string, fen: string, whiteTime?: number, blackTime?: number): Promise<void> {
    try {
      const ref = this.db.ref(`${this.ACTIVE_GAMES_PATH}/${uid}`);
      await ref.update({
        fen,
        whiteTime,
        blackTime,
        lastUpdateAt: Date.now(),
      });
    } catch (error) {
      logger.error("Error updating game state:", error);
    }
  }

  /**
   * Remove active game
   */
  async removeActiveGame(uid: string): Promise<void> {
    try {
      const ref = this.db.ref(`${this.ACTIVE_GAMES_PATH}/${uid}`);
      await ref.remove();
      logger.info(`Active game removed for user ${uid}`);
    } catch (error) {
      logger.error("Error removing active game:", error);
    }
  }

  /**
   * Save match to history in Firestore
   */
  async saveMatchHistory(uid: string, matchData: MatchHistory): Promise<void> {
    try {
      await this.firestore
        .collection('users')
        .doc(uid)
        .collection('matches')
        .doc(matchData.matchId)
        .set(matchData);
      logger.info(`Match history saved for user ${uid}, matchId: ${matchData.matchId}`);
    } catch (error) {
      logger.error("Error saving match history:", error);
      throw error;
    }
  }

  /**
   * Get match history for a user from Firestore (with pagination)
   */
  async getMatchHistory(uid: string, limit: number = 20): Promise<MatchHistory[]> {
    try {
      const snapshot = await this.firestore
        .collection('users')
        .doc(uid)
        .collection('matches')
        .orderBy('endTime', 'desc')
        .limit(limit)
        .get();
      
      if (snapshot.empty) {
        return [];
      }

      const matches: MatchHistory[] = [];
      snapshot.forEach((doc) => {
        matches.push(doc.data() as MatchHistory);
      });

      return matches;
    } catch (error) {
      logger.error("Error getting match history:", error);
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

    // Check if player was disconnected and timeout expired
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
   * Handle game end - save to history and cleanup active game
   */
  async handleGameEnd(
    gameId: string,
    players: { uid: string; name: string; color: "white" | "black" }[],
    winner: "white" | "black" | "draw",
    gameType: "bot" | "pvp",
    startTime: number
  ): Promise<void> {
    try {
      const endTime = Date.now();
      const duration = Math.floor((endTime - startTime) / 1000);

      // Save match history for each player
      for (const player of players) {
        let result: "win" | "loss" | "draw";
        if (winner === "draw") {
          result = "draw";
        } else {
          result = winner === player.color ? "win" : "loss";
        }

        const opponent = players.find(p => p.uid !== player.uid);

        const matchData: MatchHistory = {
          matchId: gameId,
          gameType,
          result,
          playerColor: player.color,
          opponent: {
            name: opponent?.name || (gameType === "bot" ? "Bot" : "Unknown"),
            uid: opponent?.uid || "bot",
          },
          startTime,
          endTime,
          duration,
          winner,
        };

        await this.saveMatchHistory(player.uid, matchData);
        await this.removeActiveGame(player.uid);
      }

      logger.info(`Game ${gameId} ended, history saved for all players`);
    } catch (error) {
      logger.error("Error handling game end:", error);
    }
  }

  /**
   * Cleanup stale games (older than 1 hour)
   */
  async cleanupStaleGames(): Promise<void> {
    try {
      const ref = this.db.ref(this.ACTIVE_GAMES_PATH);
      const snapshot = await ref.once("value");
      
      if (!snapshot.exists()) {
        return;
      }

      const oneHourAgo = Date.now() - 3600000;
      const updates: { [key: string]: null } = {};

      snapshot.forEach((childSnapshot) => {
        const data = childSnapshot.val() as ActiveGame;
        if (data.lastUpdateAt < oneHourAgo) {
          updates[childSnapshot.key!] = null;
        }
      });

      if (Object.keys(updates).length > 0) {
        await ref.update(updates);
        logger.info(`Cleaned up ${Object.keys(updates).length} stale games`);
      }
    } catch (error) {
      logger.error("Error cleaning up stale games:", error);
    }
  }
}

export const gamePersistenceService = new GamePersistenceService();
