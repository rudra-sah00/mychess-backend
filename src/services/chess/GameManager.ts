import { nanoid } from "nanoid";
import ChessEngine, { MoveResult } from "./ChessEngine";
import ClockService, { ClockConfig, ClockState } from "./ClockService";
import { gamePersistenceService } from "../persistence/GamePersistenceService";
import logger from "../../config/logger";
import { PieceSymbol } from "chess.js";
import type { Server } from "socket.io";
import redisClient from "../redis/redisClient";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  private cleanupDelayMs = 30000; // 30 seconds delay before cleanup
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private clockUpdateCallback?: (gameId: string, data: any) => void;
  private botGameDisconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private pvpDisconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private waitingPlayers: Map<string, string> = new Map(); // gameId -> uid
  private lastPersistAt: Map<string, number> = new Map(); // gameId -> timestamp
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

    // Save active game to Redis
    await redisClient.set(`game:${gameId}`, JSON.stringify(gameData));

    // Create DB entry ahead of time to hold the match if it's a PvP game
    if (gameType === 'pvp') {
      try {
        await prisma.game.create({
          data: {
            id: gameId,
            whiteId: whiteUid,
            blackId: blackUid,
            pgn: gameData.pgn,
            status: "active",
            createdAt: new Date(now),
          }
        });
      } catch (err) {
        logger.error(`Could not initialize Postgres record for game ${gameId}:`, err);
      }
    }

    await this.updateGamePersistence(gameId);

    logger.info(`Game created: ${gameId} (${whiteUid} vs ${blackUid})${clockConfig ? " with time control" : ""}, type: ${gameType}`);
    return gameData;
  }

  async loadGame(gameId: string): Promise<GameData | null> {
    if (this.games.has(gameId)) {
      return this.games.get(gameId)!.data;
    }

    const dataStr = await redisClient.get(`game:${gameId}`);
    if (!dataStr) {
      // Check Postgres if it exists but is completed
      const dbGame = await prisma.game.findUnique({ where: { id: gameId } });
      if (!dbGame) return null;

      const gameData: GameData = {
        gameId: dbGame.id,
        whitePlayer: { uid: dbGame.whiteId },
        blackPlayer: { uid: dbGame.blackId },
        fen: "", // We might not have fen in postgres, only PGN
        pgn: dbGame.pgn,
        status: dbGame.status as "completed",
        winner: dbGame.winnerId === dbGame.whiteId ? "white" : (dbGame.winnerId === dbGame.blackId ? "black" : "draw"),
        turn: "w",
        createdAt: dbGame.createdAt.getTime(),
      };
      return gameData;
    }

    const gameData = JSON.parse(dataStr) as GameData;

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
      const movesStr = await redisClient.get(`game:${gameId}:moves`);
      if (!movesStr) {
        return [];
      }
      return JSON.parse(movesStr);
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
    data.turn = engine.getGameState().turn;
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

      this.scheduleGameCleanup(gameId);
    }

    const moveNumber = engine.getGameState().history.length;

    const moveData: Record<string, any> = {
      moveNumber,
      from,
      to,
      san: result.move!.san,
      color: playerColor,
      timestamp: now,
      clockState: data.clockState,
    };

    if (promotion) moveData.promotion = promotion;
    if (result.move!.captured) moveData.captured = result.move!.captured;
    if (result.move!.flags) moveData.flags = result.move!.flags;

    // Save history to Redis array
    const historyStr = await redisClient.get(`game:${gameId}:moves`);
    const history = historyStr ? JSON.parse(historyStr) : [];
    history.push(moveData);
    await redisClient.set(`game:${gameId}:moves`, JSON.stringify(history));

    await redisClient.set(`game:${gameId}`, JSON.stringify(data));

    await this.updateGamePersistence(gameId);

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

    await redisClient.set(`game:${gameId}`, JSON.stringify(data));

    logger.info(`Player ${uid} resigned in game ${gameId}`);

    await this.saveMatchHistory(gameId);
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
    await redisClient.set(`game:${gameId}`, JSON.stringify(data));

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

      await redisClient.set(`game:${gameId}`, JSON.stringify(data));

      logger.info(`Draw accepted in game ${gameId}`);

      await this.saveMatchHistory(gameId);
      this.scheduleGameCleanup(gameId);

      return result;
    } else {
      data.drawOffer = undefined;
      await redisClient.set(`game:${gameId}`, JSON.stringify(data));
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
    } else if (data.blackPlayer.uid === uid) {
      data.blackPlayer.socketId = socketId;
    }
    await redisClient.set(`game:${gameId}`, JSON.stringify(data));

    logger.debug(`Updated socket ID for ${uid} in game ${gameId}`);
  }

  removeGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (game?.clock) {
      game.clock.stop();
    }
    this.games.delete(gameId);

    const timer = this.cleanupTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(gameId);
    }

    logger.debug(`Game removed from memory: ${gameId}`);
  }

  private scheduleGameCleanup(gameId: string): void {
    const existingTimer = this.cleanupTimers.get(gameId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

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

    try {
      // Remove from redis
      await redisClient.del([`game:${gameId}`, `game:${gameId}:moves`]);

      this.removeGame(gameId);

      logger.info(`Game ${gameId} cleaned up and saved to DB`);
    } catch (error) {
      logger.error(`Error cleaning up game ${gameId}:`, error);
      throw error;
    }
  }

  cancelCleanup(gameId: string): void {
    const timer = this.cleanupTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(gameId);
      logger.debug(`Cancelled cleanup for game ${gameId}`);
    }
  }

  setCleanupDelay(delayMs: number): void {
    this.cleanupDelayMs = delayMs;
    logger.info(`Game cleanup delay set to ${delayMs}ms`);
  }

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

  async getPlayerCompletedGames(uid: string, limit: number = 10): Promise<any[]> {
    try {
      const games = await prisma.game.findMany({
        where: { OR: [{ whiteId: uid }, { blackId: uid }], status: "completed" },
        orderBy: { endedAt: "desc" },
        take: limit,
      });
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

    await redisClient.set(`game:${gameId}`, JSON.stringify(data));

    logger.warn(`Game ${gameId} ended by timeout: ${timedOutColor}`);

    if (this.io) {
      const chessNs = this.io.of('/chess');
      chessNs?.to(gameId).emit('game-over', {
        winner: result.winner,
        reason: result.reason,
        finalFen: engine.getFen(),
        pgn: engine.getPgn(),
      });

      const socketsInRoom = await chessNs?.in(gameId).fetchSockets();
      if (socketsInRoom) {
        for (const sock of socketsInRoom) {
          sock.leave(gameId);
        }
      }
    }

    await this.saveMatchHistory(gameId);

    this.scheduleGameCleanup(gameId);
  }

  private handleClockUpdate(gameId: string, clockState: ClockState): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    game.data.clockState = clockState;

    // Throttle Redis writes to once every 10s per game
    const now = Date.now();
    const last = this.lastPersistAt.get(gameId) ?? 0;
    if (now - last >= 10000) {
      this.lastPersistAt.set(gameId, now);
      this.updateGamePersistence(gameId);
    }

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

  private async updateGamePersistence(gameId: string): Promise<void> {
    try {
    const game = this.games.get(gameId);
    if (!game || game.data.status !== 'active') {
      return;
    }

    const { data } = game;

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
    } catch (error) {
      logger.error(`updateGamePersistence error for game ${gameId}:`, error);
    }
  }

  async handlePlayerDisconnect(gameId: string, uid: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.data.status !== 'active') {
      return;
    }

    await gamePersistenceService.updateGameStatus(uid, 'disconnected');

    logger.info(`Player ${uid} disconnected from game ${gameId}, waiting for reconnection...`);

    if (game.data.gameType === 'bot') {
      const timerId = setTimeout(async () => {
        const activeGame = await gamePersistenceService.getActiveGame(uid);

        if (activeGame && activeGame.status === 'disconnected' && activeGame.gameId === gameId) {
          logger.warn(`Player ${uid} didn't rejoin bot game ${gameId} within 1 minute, cleaning up...`);

          await gamePersistenceService.removeActiveGame(uid);

          this.games.delete(gameId);
          this.botGameDisconnectTimers.delete(gameId);
          await redisClient.del(`game:${gameId}`);

          logger.info(`Bot game ${gameId} cleaned up from server and Redis`);
        }
      }, 60000);

      this.botGameDisconnectTimers.set(gameId, timerId);
      return;
    }

    const opponentUid = game.data.whitePlayer.uid === uid ? game.data.blackPlayer.uid : game.data.whitePlayer.uid;
    const opponentSocketId = game.data.whitePlayer.uid === uid ? game.data.blackPlayer.socketId : game.data.whitePlayer.socketId;

    const opponentActiveGame = await gamePersistenceService.getActiveGame(opponentUid);

    if (!opponentActiveGame || opponentActiveGame.status === 'disconnected') {
      logger.warn(`Both players disconnected from game ${gameId}, cleaning up immediately`);

      game.data.status = 'completed';
      game.data.winner = 'draw';
      game.data.endReason = 'Both players disconnected';
      game.data.lastMoveAt = Date.now();

      await gamePersistenceService.removeActiveGame(game.data.whitePlayer.uid);
      await gamePersistenceService.removeActiveGame(game.data.blackPlayer.uid);

      this.scheduleGameCleanup(gameId);
      this.pvpDisconnectTimers.delete(gameId);

      return;
    }

    if (opponentSocketId && this.io) {
      const chessNs = this.io.of('/chess');
      chessNs?.to(opponentSocketId).emit('opponent-disconnected', {
        gameId,
        message: 'Your opponent disconnected. Waiting for reconnection...',
        showWaitButton: true
      });
      this.waitingPlayers.set(gameId, opponentUid);
    }

    const timerId = setTimeout(async () => {
      const activeGame = await gamePersistenceService.getActiveGame(uid);

      if (activeGame && activeGame.status === 'disconnected' && activeGame.gameId === gameId) {
        logger.warn(`Player ${uid} failed to reconnect to game ${gameId} within 1 minute`);

        const playerColor = game.data.whitePlayer.uid === uid ? 'w' : 'b';
        const winner = playerColor === 'w' ? 'black' : 'white';
        const winnerName = playerColor === 'w' ? game.data.blackPlayer.name : game.data.whitePlayer.name;

        game.data.status = 'completed';
        game.data.winner = winner;
        game.data.endReason = 'Opponent disconnected';
        game.data.lastMoveAt = Date.now();

        await gamePersistenceService.removeActiveGame(game.data.whitePlayer.uid);
        await gamePersistenceService.removeActiveGame(game.data.blackPlayer.uid);
        this.pvpDisconnectTimers.delete(gameId);
        this.waitingPlayers.delete(gameId);

        if (opponentSocketId && this.io) {
          const chessNs = this.io.of('/chess');
          chessNs?.to(opponentSocketId).emit('game-ended-disconnect', {
            gameId,
            winner,
            winnerName,
            reason: 'Opponent failed to reconnect'
          });

          const socketsInRoom = await chessNs?.in(gameId).fetchSockets();
          if (socketsInRoom) {
            for (const sock of socketsInRoom) {
              sock.leave(gameId);
            }
          }
        }

        this.scheduleGameCleanup(gameId);
      }
    }, 60000);

    this.pvpDisconnectTimers.set(gameId, timerId);
  }

  async cancelWaitTimer(gameId: string, uid: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    if (this.waitingPlayers.get(gameId) !== uid) {
      logger.warn(`Player ${uid} tried to cancel wait but is not the waiting player`);
      return;
    }

    if (this.pvpDisconnectTimers.has(gameId)) {
      clearTimeout(this.pvpDisconnectTimers.get(gameId));
      this.pvpDisconnectTimers.delete(gameId);

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

  async handlePlayerReconnect(gameId: string, uid: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    if (game.data.gameType === 'bot' && this.botGameDisconnectTimers.has(gameId)) {
      clearTimeout(this.botGameDisconnectTimers.get(gameId));
      this.botGameDisconnectTimers.delete(gameId);
    }

    if (this.pvpDisconnectTimers.has(gameId)) {
      clearTimeout(this.pvpDisconnectTimers.get(gameId));
      this.pvpDisconnectTimers.delete(gameId);
      this.waitingPlayers.delete(gameId);

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

    await gamePersistenceService.updateGameStatus(uid, 'active');
  }

  async checkActiveGame(uid: string): Promise<{ hasActiveGame: boolean; gameId?: string; gameData?: any }> {
    const activeGame = await gamePersistenceService.checkReconnection(uid);

    if (!activeGame) {
      return { hasActiveGame: false };
    }

    const game = await this.loadGame(activeGame.gameId);

    if (!game || game.status !== 'active') {
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

  private async saveMatchHistory(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.data.status !== 'completed') {
      return;
    }

    const { data } = game;
    const players: { uid: string; name: string; color: "white" | "black" }[] = [];

    if (data.whitePlayer.uid !== 'BOT') {
      players.push({
        uid: data.whitePlayer.uid,
        name: data.whitePlayer.name || 'Player',
        color: 'white',
      });
    }

    if (data.blackPlayer.uid !== 'BOT') {
      players.push({
        uid: data.blackPlayer.uid,
        name: data.blackPlayer.name || 'Player',
        color: 'black',
      });
    }

    try {
      let winnerId: string | null = null;
      if (game.data.winner === 'white') winnerId = game.data.whitePlayer.uid;
      if (game.data.winner === 'black') winnerId = game.data.blackPlayer.uid;

      if (game.data.gameType === 'pvp') {
        await prisma.game.update({
          where: { id: gameId },
          data: {
            pgn: game.data.pgn,
            status: 'completed',
            endedAt: new Date(),
            winnerId,
          }
        });
        logger.info(`Match history saved for game ${gameId} to postgres`);
      }
    } catch (e) {
      logger.error(`Could not persist game ${gameId} to DB: `, e);
    }
  }
}

export const gameManager = new GameManager();

export default GameManager;
