import { nanoid } from "nanoid";
import ChessEngine, { MoveResult } from "./ChessEngine";
import ClockService, { ClockConfig, ClockState } from "./ClockService";
import { firebaseAdmin } from "../firebase/firebaseAdmin";
import { gamePersistenceService } from "../firebase/GamePersistenceService";
import logger from "../../config/logger";
import { PieceSymbol } from "chess.js";
import type { Server } from "socket.io";

export interface Player {
  uid: string;
  color: "white" | "black";
  socketId: string;
}

export interface GameData {
  gameId: string;
  whitePlayer: { uid: string; socketId?: string; name?: string };
  blackPlayer: { uid: string; socketId?: string; name?: string };
  fen: string;
  pgn: string;
  status: "waiting" | "active" | "completed";
  winner?: "white" | "black" | "draw";
  endReason?: string;
  turn: "w" | "b";
  clockState?: ClockState;
  clockConfig?: ClockConfig;
  createdAt: number;
  lastMoveAt?: number;
  drawOffer?: { from: "white" | "black"; pending: boolean };
  roomId?: string; // Associated room ID if created from room
  gameType?: "bot" | "pvp"; // Type of game
}

export interface MoveData {
  moveNumber: number;
  from: string;
  to: string;
  promotion?: string;
  san: string;
  color: "w" | "b";
  timestamp: number;
  clockState?: ClockState;
}

export class GameManager {
  private games: Map<string, { engine: ChessEngine; clock?: ClockService; data: GameData }> = new Map();
  private db = firebaseAdmin.getDatabase();
  private firestore = firebaseAdmin.getFirestore();
  private cleanupDelayMs = 30000; // 30 seconds delay before cleanup
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private clockUpdateCallback?: (gameId: string, data: any) => void;
  private botGameDisconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private pvpDisconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private waitingPlayers: Map<string, string> = new Map(); // gameId -> uid of waiting player
  private io: Server | null = null;

  setSocketIO(io: Server): void {
    this.io = io;
  }

  setClockUpdateCallback(callback: (gameId: string, data: any) => void): void {
    this.clockUpdateCallback = callback;
  }

  async createGame(
    whiteUid: string,
    blackUid: string,
    whiteSocketId: string,
    blackSocketId: string,
    clockConfig?: ClockConfig,
    roomId?: string,
    whiteName?: string,
    blackName?: string
  ): Promise<GameData> {
    const gameId = nanoid(10);
    const engine = new ChessEngine(gameId);
    const now = Date.now();

    // Determine game type
    const gameType = (whiteUid === 'BOT' || blackUid === 'BOT') ? 'bot' : 'pvp';

    const gameData: GameData = {
      gameId,
      whitePlayer: { uid: whiteUid, socketId: whiteSocketId, name: whiteName },
      blackPlayer: { uid: blackUid, socketId: blackSocketId, name: blackName },
      fen: engine.getFen(),
      pgn: engine.getPgn(),
      status: "active",
      turn: "w",
      createdAt: now,
      clockConfig,
      roomId,
      gameType,
    };

    let clock: ClockService | undefined;
    if (clockConfig) {
      clock = new ClockService(
        gameId,
        clockConfig,
        (timedOutColor) => this.handleTimeout(gameId, timedOutColor),
        (clockState) => this.handleClockUpdate(gameId, clockState)
      );
      clock.start("w");
      gameData.clockState = clock.getState();
    }

    this.games.set(gameId, { engine, clock, data: gameData });

    // Build Firebase data, excluding undefined values
    const firebaseData: Record<string, any> = {
      ...gameData,
      whitePlayer: { uid: whiteUid, name: whiteName },
      blackPlayer: { uid: blackUid, name: blackName },
    };

    // Remove roomId if it's undefined (e.g., for bot games)
    if (roomId === undefined) {
      delete firebaseData.roomId;
    }

    await this.db.ref(`games/${gameId}`).set(firebaseData);

    // Save initial persistence for active players
    await this.updateGamePersistence(gameId);

    logger.info(`Game created: ${gameId} (${whiteUid} vs ${blackUid})${clockConfig ? " with time control" : ""}, type: ${gameType}`);
    return gameData;
  }

  async loadGame(gameId: string): Promise<GameData | null> {
    if (this.games.has(gameId)) {
      return this.games.get(gameId)!.data;
    }

    const snapshot = await this.db.ref(`games/${gameId}`).once("value");
    if (!snapshot.exists()) {
      return null;
    }

    const gameData = snapshot.val() as GameData;

    const engine = new ChessEngine(gameId, gameData.fen);
    let clock: ClockService | undefined;

    if (gameData.clockConfig && gameData.clockState) {
      clock = new ClockService(
        gameId,
        gameData.clockConfig,
        (timedOutColor) => this.handleTimeout(gameId, timedOutColor),
        (clockState) => this.handleClockUpdate(gameId, clockState)
      );
      clock.restoreState(gameData.clockState);
    }

    this.games.set(gameId, { engine, clock, data: gameData });
    logger.info(`Game loaded: ${gameId}`);

    return gameData;
  }

  getGame(gameId: string): GameData | null {
    return this.games.get(gameId)?.data || null;
  }

  async getMoveHistory(gameId: string): Promise<any[]> {
    try {
      const movesSnapshot = await this.db.ref(`games/${gameId}/moves`).once("value");
      if (!movesSnapshot.exists()) {
        return [];
      }
      return Object.values(movesSnapshot.val());
    } catch (error) {
      logger.error(`Error loading move history for game ${gameId}:`, error);
      return [];
    }
  }

  async applyMove(gameId: string, uid: string, from: string, to: string, promotion?: string): Promise<MoveResult> {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: "Game not found" };
    }

    const { engine, clock, data } = game;

    const playerColor = data.whitePlayer.uid === uid ? "w" : data.blackPlayer.uid === uid ? "b" : null;
    if (!playerColor) {
      return { success: false, error: "You are not a player in this game" };
    }

    if (data.turn !== playerColor) {
      return { success: false, error: "Not your turn" };
    }

    const result = engine.validateMove(from, to, promotion as PieceSymbol | undefined, uid, playerColor);
    if (!result.success) {
      return result;
    }

    const now = Date.now();
    data.fen = engine.getFen();
    data.pgn = engine.getPgn();
    data.turn = engine.getGameState().turn; // Get turn from engine (chess.js flips it after move)
    data.lastMoveAt = now;

    if (clock) {
      clock.switchClock(playerColor);
      data.clockState = clock.getState();
    }

    if (result.isGameOver) {
      data.status = "completed";
      data.winner = result.winner;
      data.endReason = result.reason;
      if (clock) {
        clock.stop();
        data.clockState = clock.getState();
      }
      
      // Schedule cleanup after game completion
      this.scheduleGameCleanup(gameId);
    }

    const moveNumber = engine.getGameState().history.length;
    
    // Build move data, excluding undefined values for Firebase
    const moveData: Record<string, any> = {
      moveNumber,
      from,
      to,
      san: result.move!.san,
      color: playerColor,
      timestamp: now,
      clockState: data.clockState,
    };

    // Only include promotion if it exists
    if (promotion) {
      moveData.promotion = promotion;
    }

    // Include captured piece if any
    if (result.move!.captured) {
      moveData.captured = result.move!.captured;
    }

    // Include flags (castling, en passant, etc.)
    if (result.move!.flags) {
      moveData.flags = result.move!.flags;
    }

    // Build update object, excluding undefined values
    const gameUpdate: Record<string, any> = {
      fen: data.fen,
      pgn: data.pgn,
      turn: data.turn,
      lastMoveAt: data.lastMoveAt,
      status: data.status,
      clockState: data.clockState,
    };

    // Only include winner and endReason if game is over
    if (result.isGameOver) {
      gameUpdate.winner = data.winner;
      gameUpdate.endReason = data.endReason;
    }

    await Promise.all([
      this.db.ref(`games/${gameId}`).update(gameUpdate),
      this.db.ref(`games/${gameId}/moves/${moveNumber}`).set(moveData),
    ]);

    // Update persistence after move
    await this.updateGamePersistence(gameId);

    // If game ended, save to match history
    if (result.isGameOver) {
      await this.saveMatchHistory(gameId);
    }

    logger.info(`Move applied in game ${gameId}: ${from} to ${to} by ${uid}`);
    return result;
  }

  async resign(gameId: string, uid: string): Promise<MoveResult> {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: "Game not found" };
    }

    const { engine, clock, data } = game;

    const resigningColor = data.whitePlayer.uid === uid ? "w" : data.blackPlayer.uid === uid ? "b" : null;
    if (!resigningColor) {
      return { success: false, error: "You are not a player in this game" };
    }

    const result = engine.handleResignation(resigningColor);

    data.status = "completed";
    data.winner = result.winner;
    data.endReason = result.reason;
    data.lastMoveAt = Date.now();

    if (clock) {
      clock.stop();
      data.clockState = clock.getState();
    }

    await this.db.ref(`games/${gameId}`).update({
      status: data.status,
      winner: data.winner,
      endReason: data.endReason,
      lastMoveAt: data.lastMoveAt,
      clockState: data.clockState,
    });

    logger.info(`Player ${uid} resigned in game ${gameId}`);
    
    // Save to match history
    await this.saveMatchHistory(gameId);
    
    // Schedule cleanup after resignation
    this.scheduleGameCleanup(gameId);
    
    return result;
  }

  async offerDraw(gameId: string, uid: string): Promise<{ success: boolean; error?: string }> {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: "Game not found" };
    }

    const { data } = game;
    const offeringColor = data.whitePlayer.uid === uid ? "white" : data.blackPlayer.uid === uid ? "black" : null;
    if (!offeringColor) {
      return { success: false, error: "You are not a player in this game" };
    }

    data.drawOffer = { from: offeringColor, pending: true };

    await this.db.ref(`games/${gameId}/drawOffer`).set(data.drawOffer);

    logger.info(`Draw offered by ${uid} in game ${gameId}`);
    return { success: true };
  }

  async respondToDrawOffer(
    gameId: string,
    uid: string,
    accept: boolean
  ): Promise<MoveResult | { success: boolean; error?: string }> {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: "Game not found" };
    }

    const { engine, clock, data } = game;

    if (!data.drawOffer?.pending) {
      return { success: false, error: "No pending draw offer" };
    }

    const respondingColor = data.whitePlayer.uid === uid ? "white" : data.blackPlayer.uid === uid ? "black" : null;
    if (!respondingColor || respondingColor === data.drawOffer.from) {
      return { success: false, error: "Invalid draw response" };
    }

    if (accept) {
      const result = engine.handleDrawAgreement();

      data.status = "completed";
      data.winner = result.winner;
      data.endReason = result.reason;
      data.lastMoveAt = Date.now();
      data.drawOffer = undefined;

      if (clock) {
        clock.stop();
        data.clockState = clock.getState();
      }

      await this.db.ref(`games/${gameId}`).update({
        status: data.status,
        winner: data.winner,
        endReason: data.endReason,
        lastMoveAt: data.lastMoveAt,
        clockState: data.clockState,
        drawOffer: null,
      });

      logger.info(`Draw accepted in game ${gameId}`);
      
      // Save to match history
      await this.saveMatchHistory(gameId);
      
      // Schedule cleanup after draw
      this.scheduleGameCleanup(gameId);
      
      return result;
    } else {
      data.drawOffer = undefined;
      await this.db.ref(`games/${gameId}/drawOffer`).remove();
      logger.info(`Draw declined in game ${gameId}`);
      return { success: true };
    }
  }

  async updateSocketId(gameId: string, uid: string, socketId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    const { data } = game;
    if (data.whitePlayer.uid === uid) {
      data.whitePlayer.socketId = socketId;
      await this.db.ref(`games/${gameId}/whitePlayer/socketId`).set(socketId);
    } else if (data.blackPlayer.uid === uid) {
      data.blackPlayer.socketId = socketId;
      await this.db.ref(`games/${gameId}/blackPlayer/socketId`).set(socketId);
    }

    logger.debug(`Updated socket ID for ${uid} in game ${gameId}`);
  }

  removeGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (game?.clock) {
      game.clock.stop();
    }
    this.games.delete(gameId);
    
    // Clear any pending cleanup timer
    const timer = this.cleanupTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(gameId);
    }
    
    logger.debug(`Game removed from memory: ${gameId}`);
  }

  /**
   * Schedule automatic cleanup of completed game
   * Removes game data from Firebase and memory after delay
   */
  private scheduleGameCleanup(gameId: string): void {
    // Clear any existing timer for this game
    const existingTimer = this.cleanupTimers.get(gameId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule cleanup
    const timer = setTimeout(async () => {
      try {
        await this.cleanupGame(gameId);
      } catch (error) {
        logger.error(`Failed to cleanup game ${gameId}:`, error);
      } finally {
        this.cleanupTimers.delete(gameId);
      }
    }, this.cleanupDelayMs);

    this.cleanupTimers.set(gameId, timer);
    logger.debug(`Scheduled cleanup for game ${gameId} in ${this.cleanupDelayMs}ms`);
  }

  /**
   * Clean up completed game from Firebase and memory
   * Archives to Firestore for permanent storage
   */
  private async cleanupGame(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    
    if (!game) {
      logger.debug(`Game ${gameId} already removed from memory`);
      return;
    }

    if (game.data.status !== 'completed') {
      logger.warn(`Attempted to cleanup active game ${gameId}, skipping`);
      return;
    }

    const archiveData = {
      ...game.data,
      archivedAt: Date.now(),
      completedAt: game.data.lastMoveAt || Date.now(),
    };

    // Remove undefined fields and temporary metadata for Firestore compatibility
    delete (archiveData as any).roomId; // roomId is temporary, don't archive it
    
    Object.keys(archiveData).forEach(key => {
      if (archiveData[key as keyof typeof archiveData] === undefined) {
        delete archiveData[key as keyof typeof archiveData];
      }
    });

    try {
      // Save to Firestore under each player's UID
      const whiteUid = game.data.whitePlayer.uid;
      const blackUid = game.data.blackPlayer.uid;
      
      // Store under white player's games
      if (whiteUid !== 'BOT') {
        await this.firestore.collection('users').doc(whiteUid).collection('games').doc(gameId).set(archiveData);
      }
      
      // Store under black player's games
      if (blackUid !== 'BOT') {
        await this.firestore.collection('users').doc(blackUid).collection('games').doc(gameId).set(archiveData);
      }
      
      // Delete from active games in Realtime DB
      await this.db.ref(`games/${gameId}`).remove();
      
      // Remove from memory
      this.removeGame(gameId);
      
      logger.info(`Game ${gameId} cleaned up and saved to Firestore under player UIDs`);
    } catch (error) {
      logger.error(`Error cleaning up game ${gameId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel scheduled cleanup for a game
   */
  cancelCleanup(gameId: string): void {
    const timer = this.cleanupTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(gameId);
      logger.debug(`Cancelled cleanup for game ${gameId}`);
    }
  }

  /**
   * Set custom cleanup delay (useful for testing)
   */
  setCleanupDelay(delayMs: number): void {
    this.cleanupDelayMs = delayMs;
    logger.info(`Game cleanup delay set to ${delayMs}ms`);
  }

  /**
   * Manually trigger cleanup for completed games
   */
  async cleanupCompletedGames(): Promise<number> {
    let count = 0;
    const promises: Promise<void>[] = [];

    for (const [gameId, game] of this.games.entries()) {
      if (game.data.status === 'completed') {
        promises.push(this.cleanupGame(gameId));
        count++;
      }
    }

    await Promise.all(promises);
    logger.info(`Manually cleaned up ${count} completed games`);
    return count;
  }

  /**
   * Get completed game from Firestore (searches user's games)
   */
  async getCompletedGame(gameId: string, uid: string): Promise<GameData | null> {
    try {
      const doc = await this.firestore.collection('users').doc(uid).collection('games').doc(gameId).get();
      if (!doc.exists) {
        return null;
      }
      return doc.data() as GameData;
    } catch (error) {
      logger.error(`Error fetching completed game ${gameId}:`, error);
      return null;
    }
  }

  /**
   * Get player's completed games from Firestore
   */
  async getPlayerCompletedGames(uid: string, limit: number = 10): Promise<GameData[]> {
    try {
      const snapshot = await this.firestore
        .collection('users')
        .doc(uid)
        .collection('games')
        .orderBy('completedAt', 'desc')
        .limit(limit)
        .get();

      const games: GameData[] = [];
      snapshot.forEach(doc => games.push(doc.data() as GameData));

      return games;
    } catch (error) {
      logger.error(`Error fetching player games for ${uid}:`, error);
      return [];
    }
  }

  private async handleTimeout(gameId: string, timedOutColor: "w" | "b"): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    const { engine, data } = game;
    const result = engine.handleTimeout(timedOutColor);

    data.status = "completed";
    data.winner = result.winner;
    data.endReason = result.reason;
    data.lastMoveAt = Date.now();
    data.clockState = game.clock?.getState();

    await this.db.ref(`games/${gameId}`).update({
      status: data.status,
      winner: data.winner,
      endReason: data.endReason,
      lastMoveAt: data.lastMoveAt,
      clockState: data.clockState,
    });

    logger.warn(`Game ${gameId} ended by timeout: ${timedOutColor}`);
    
    // Notify players via socket
    if (this.io) {
      const chessNs = this.io.of('/chess');
      chessNs?.to(gameId).emit('game-over', {
        winner: result.winner,
        reason: result.reason,
        finalFen: engine.getFen(),
        pgn: engine.getPgn(),
      });
      
      // Remove all sockets from game room after timeout
      const socketsInRoom = await chessNs?.in(gameId).fetchSockets();
      if (socketsInRoom) {
        for (const sock of socketsInRoom) {
          sock.leave(gameId);
        }
        logger.info(`Removed ${socketsInRoom.length} sockets from game room ${gameId} after timeout`);
      }
    }
    
    // Save to match history
    await this.saveMatchHistory(gameId);
    
    // Schedule cleanup after timeout
    this.scheduleGameCleanup(gameId);
  }

  private handleClockUpdate(gameId: string, clockState: ClockState): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    game.data.clockState = clockState;
    
    // Update persistence with new clock state
    this.updateGamePersistence(gameId);
    
    // Emit clock update to all players in game
    if (this.clockUpdateCallback) {
      this.clockUpdateCallback(gameId, {
        gameId,
        clocks: {
          white: { remaining: clockState.whiteTimeMs },
          black: { remaining: clockState.blackTimeMs },
        },
        turn: clockState.activeColor === 'w' ? 'white' : 'black',
        activeColor: clockState.activeColor,
      });
    }
  }

  /**
   * Save/update active game to persistence layer
   */
  private async updateGamePersistence(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.data.status !== 'active') {
      return;
    }

    const { data } = game;
    
    // Save active game for white player (human only)
    if (data.whitePlayer.uid !== 'BOT') {
      await gamePersistenceService.saveActiveGame(data.whitePlayer.uid, {
        gameId: data.gameId,
        type: data.gameType || 'pvp',
        playerUid: data.whitePlayer.uid,
        opponentUid: data.blackPlayer.uid !== 'BOT' ? data.blackPlayer.uid : undefined,
        playerColor: 'white',
        fen: data.fen,
        startedAt: data.createdAt,
        lastUpdateAt: Date.now(),
        status: 'active',
        timeControl: data.clockConfig,
        whiteTime: data.clockState?.whiteTimeMs,
        blackTime: data.clockState?.blackTimeMs,
      });
    }

    // Save active game for black player (human only)
    if (data.blackPlayer.uid !== 'BOT') {
      await gamePersistenceService.saveActiveGame(data.blackPlayer.uid, {
        gameId: data.gameId,
        type: data.gameType || 'pvp',
        playerUid: data.blackPlayer.uid,
        opponentUid: data.whitePlayer.uid !== 'BOT' ? data.whitePlayer.uid : undefined,
        playerColor: 'black',
        fen: data.fen,
        startedAt: data.createdAt,
        lastUpdateAt: Date.now(),
        status: 'active',
        timeControl: data.clockConfig,
        whiteTime: data.clockState?.whiteTimeMs,
        blackTime: data.clockState?.blackTimeMs,
      });
    }
  }

  /**
   * Handle player disconnection
   */
  async handlePlayerDisconnect(gameId: string, uid: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.data.status !== 'active') {
      return;
    }

    // Mark as disconnected in persistence
    await gamePersistenceService.updateGameStatus(uid, 'disconnected');
    
    logger.info(`Player ${uid} disconnected from game ${gameId}, waiting for reconnection...`);

    // For bot games, set 1-minute cleanup timer
    if (game.data.gameType === 'bot') {
      const timerId = setTimeout(async () => {
        const activeGame = await gamePersistenceService.getActiveGame(uid);
        
        // Check if player reconnected
        if (activeGame && activeGame.status === 'disconnected' && activeGame.gameId === gameId) {
          logger.warn(`Player ${uid} didn't rejoin bot game ${gameId} within 1 minute, cleaning up...`);
          
          // Clean up from RTDB
          await gamePersistenceService.removeActiveGame(uid);
          
          // Clean up from server
          this.games.delete(gameId);
          this.botGameDisconnectTimers.delete(gameId);
          
          logger.info(`Bot game ${gameId} cleaned up from server and RTDB`);
        }
      }, 60000); // 1 minute
      
      this.botGameDisconnectTimers.set(gameId, timerId);
      return;
    }

    // For PvP/friend games, handle disconnect differently
    const opponentUid = game.data.whitePlayer.uid === uid ? game.data.blackPlayer.uid : game.data.whitePlayer.uid;
    const opponentSocketId = game.data.whitePlayer.uid === uid ? game.data.blackPlayer.socketId : game.data.whitePlayer.socketId;
    
    // Check if opponent is also disconnected
    const opponentActiveGame = await gamePersistenceService.getActiveGame(opponentUid);
    
    if (!opponentActiveGame || opponentActiveGame.status === 'disconnected') {
      // Both players disconnected - cleanup immediately
      logger.warn(`Both players disconnected from game ${gameId}, cleaning up immediately`);
      
      // Mark game as completed
      game.data.status = 'completed';
      game.data.winner = 'draw';
      game.data.endReason = 'Both players disconnected';
      game.data.lastMoveAt = Date.now();
      
      // Clean up active game refs
      await gamePersistenceService.removeActiveGame(game.data.whitePlayer.uid);
      await gamePersistenceService.removeActiveGame(game.data.blackPlayer.uid);
      
      // Schedule cleanup (will save to Firestore under player UIDs)
      this.scheduleGameCleanup(gameId);
      this.pvpDisconnectTimers.delete(gameId);
      
      return;
    }
    
    // One player disconnected, other is waiting - emit waiting state to connected player
    if (opponentSocketId && this.io) {
      const chessNs = this.io.of('/chess');
      
      chessNs?.to(opponentSocketId).emit('opponent-disconnected', {
        gameId,
        message: 'Your opponent disconnected. Waiting for reconnection...',
        showWaitButton: true
      });
      
      // Mark opponent as waiting
      this.waitingPlayers.set(gameId, opponentUid);
    }
    
    // Set 1-minute timer for reconnection
    const timerId = setTimeout(async () => {
      const activeGame = await gamePersistenceService.getActiveGame(uid);
      
      // Check if player reconnected or if waiting was cancelled
      if (activeGame && activeGame.status === 'disconnected' && activeGame.gameId === gameId) {
        logger.warn(`Player ${uid} failed to reconnect to game ${gameId} within 1 minute`);
        
        // End the game - opponent wins
        const playerColor = game.data.whitePlayer.uid === uid ? 'w' : 'b';
        const winner = playerColor === 'w' ? 'black' : 'white';
        const winnerName = playerColor === 'w' ? game.data.blackPlayer.name : game.data.whitePlayer.name;
        
        // Mark game as completed
        game.data.status = 'completed';
        game.data.winner = winner;
        game.data.endReason = 'Opponent disconnected';
        game.data.lastMoveAt = Date.now();
        
        // Clean up active game refs
        await gamePersistenceService.removeActiveGame(game.data.whitePlayer.uid);
        await gamePersistenceService.removeActiveGame(game.data.blackPlayer.uid);
        this.pvpDisconnectTimers.delete(gameId);
        this.waitingPlayers.delete(gameId);
        
        // Notify remaining player
        if (opponentSocketId && this.io) {
          const chessNs = this.io.of('/chess');
          chessNs?.to(opponentSocketId).emit('game-ended-disconnect', {
            gameId,
            winner,
            winnerName,
            reason: 'Opponent failed to reconnect'
          });
          
          // Remove all sockets from game room after disconnect timeout
          const socketsInRoom = await chessNs?.in(gameId).fetchSockets();
          if (socketsInRoom) {
            for (const sock of socketsInRoom) {
              sock.leave(gameId);
            }
            logger.info(`Removed ${socketsInRoom.length} sockets from game room ${gameId} after disconnect`);
          }
        }
        
        logger.info(`Game ${gameId} ended due to disconnect, winner: ${winnerName}`);
        
        // Schedule cleanup (will save to Firestore under player UIDs)
        this.scheduleGameCleanup(gameId);
      }
    }, 60000); // 1 minute
    
    this.pvpDisconnectTimers.set(gameId, timerId);
  }



  /**
   * Cancel wait timer - player chooses to wait indefinitely
   */
  async cancelWaitTimer(gameId: string, uid: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }
    
    // Verify this player is the waiting one
    if (this.waitingPlayers.get(gameId) !== uid) {
      logger.warn(`Player ${uid} tried to cancel wait but is not the waiting player`);
      return;
    }
    
    // Clear the disconnect timer
    if (this.pvpDisconnectTimers.has(gameId)) {
      clearTimeout(this.pvpDisconnectTimers.get(gameId));
      this.pvpDisconnectTimers.delete(gameId);
      logger.info(`Player ${uid} chose to wait indefinitely for opponent in game ${gameId}`);
      
      // Notify the waiting player
      const waitingSocketId = game.data.whitePlayer.uid === uid ? game.data.whitePlayer.socketId : game.data.blackPlayer.socketId;
      if (waitingSocketId && this.io) {
        const chessNs = this.io.of('/chess');
        chessNs?.to(waitingSocketId).emit('waiting-confirmed', {
          gameId,
          message: 'Waiting for opponent to rejoin...'
        });
      }
    }
  }

  /**
   * Handle player reconnection
   */
  async handlePlayerReconnect(gameId: string, uid: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    // Clear bot game disconnect timer if exists
    if (game.data.gameType === 'bot' && this.botGameDisconnectTimers.has(gameId)) {
      clearTimeout(this.botGameDisconnectTimers.get(gameId));
      this.botGameDisconnectTimers.delete(gameId);
      logger.info(`Cleared bot game disconnect timer for ${gameId}`);
    }
    
    // Clear PvP disconnect timer if exists
    if (this.pvpDisconnectTimers.has(gameId)) {
      clearTimeout(this.pvpDisconnectTimers.get(gameId));
      this.pvpDisconnectTimers.delete(gameId);
      this.waitingPlayers.delete(gameId);
      logger.info(`Cleared PvP disconnect timer for ${gameId}`);
      
      // Notify the waiting player that opponent reconnected
      const opponentUid = game.data.whitePlayer.uid === uid ? game.data.blackPlayer.uid : game.data.whitePlayer.uid;
      const opponentSocketId = game.data.whitePlayer.uid === uid ? game.data.blackPlayer.socketId : game.data.whitePlayer.socketId;
      
      if (opponentSocketId && this.io) {
        const chessNs = this.io.of('/chess');
        chessNs?.to(opponentSocketId).emit('opponent-reconnected', {
          gameId,
          message: 'Your opponent has reconnected!'
        });
      }
    }

    // Update status to active
    await gamePersistenceService.updateGameStatus(uid, 'active');
    logger.info(`Player ${uid} reconnected to game ${gameId}`);
  }

  /**
   * Check for active game on connection
   */
  async checkActiveGame(uid: string): Promise<{ hasActiveGame: boolean; gameId?: string; gameData?: any }> {
    const activeGame = await gamePersistenceService.checkReconnection(uid);
    
    if (!activeGame) {
      return { hasActiveGame: false };
    }

    // Load the game if it exists
    const game = await this.loadGame(activeGame.gameId);
    
    if (!game || game.status !== 'active') {
      // Game no longer active, cleanup
      await gamePersistenceService.removeActiveGame(uid);
      return { hasActiveGame: false };
    }

    return {
      hasActiveGame: true,
      gameId: activeGame.gameId,
      gameData: {
        ...game,
        reconnecting: true,
      },
    };
  }

  /**
   * Save game to match history when it ends
   */
  private async saveMatchHistory(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.data.status !== 'completed') {
      return;
    }

    const { data } = game;
    const players: { uid: string; name: string; color: "white" | "black" }[] = [];

    // Add white player if not bot
    if (data.whitePlayer.uid !== 'BOT') {
      players.push({
        uid: data.whitePlayer.uid,
        name: data.whitePlayer.name || 'Player',
        color: 'white',
      });
    }

    // Add black player if not bot
    if (data.blackPlayer.uid !== 'BOT') {
      players.push({
        uid: data.blackPlayer.uid,
        name: data.blackPlayer.name || 'Player',
        color: 'black',
      });
    }

    await gamePersistenceService.handleGameEnd(
      gameId,
      players,
      data.winner || 'draw',
      data.gameType || 'pvp',
      data.createdAt
    );

    logger.info(`Match history saved for game ${gameId}`);
  }
}

export const gameManager = new GameManager();

export default GameManager;
