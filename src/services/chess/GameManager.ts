import { nanoid } from "nanoid";
import ChessEngine, { MoveResult } from "./ChessEngine";
import ClockService, { ClockConfig, ClockState } from "./ClockService";
import { firebaseAdmin } from "../firebase/firebaseAdmin";
import logger from "../../config/logger";
import { PieceSymbol } from "chess.js";

export interface Player {
  uid: string;
  color: "white" | "black";
  socketId: string;
}

export interface GameData {
  gameId: string;
  whitePlayer: { uid: string; socketId?: string };
  blackPlayer: { uid: string; socketId?: string };
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

  async createGame(
    whiteUid: string,
    blackUid: string,
    whiteSocketId: string,
    blackSocketId: string,
    clockConfig?: ClockConfig,
    roomId?: string
  ): Promise<GameData> {
    const gameId = nanoid(10);
    const engine = new ChessEngine(gameId);
    const now = Date.now();

    const gameData: GameData = {
      gameId,
      whitePlayer: { uid: whiteUid, socketId: whiteSocketId },
      blackPlayer: { uid: blackUid, socketId: blackSocketId },
      fen: engine.getFen(),
      pgn: engine.getPgn(),
      status: "active",
      turn: "w",
      createdAt: now,
      clockConfig,
      roomId,
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

    await this.db.ref(`games/${gameId}`).set({
      ...gameData,
      whitePlayer: { uid: whiteUid },
      blackPlayer: { uid: blackUid },
    });

    logger.info(`Game created: ${gameId} (${whiteUid} vs ${blackUid})${clockConfig ? " with time control" : ""}`);
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
    data.turn = data.turn === "w" ? "b" : "w";
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
    }

    const moveNumber = engine.getGameState().history.length;
    const moveData: MoveData = {
      moveNumber,
      from,
      to,
      promotion,
      san: result.move!.san,
      color: playerColor,
      timestamp: now,
      clockState: data.clockState,
    };

    await Promise.all([
      this.db.ref(`games/${gameId}`).update({
        fen: data.fen,
        pgn: data.pgn,
        turn: data.turn,
        lastMoveAt: data.lastMoveAt,
        status: data.status,
        winner: data.winner,
        endReason: data.endReason,
        clockState: data.clockState,
      }),
      this.db.ref(`games/${gameId}/moves/${moveNumber}`).set(moveData),
    ]);

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
    logger.debug(`Game removed from memory: ${gameId}`);
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
  }

  private handleClockUpdate(gameId: string, clockState: ClockState): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    game.data.clockState = clockState;
    
    // Emit clock update to all players in game
    if (this.clockUpdateCallback) {
      this.clockUpdateCallback(gameId, {
        gameId,
        clocks: {
          white: { remaining: clockState.whiteTimeMs },
          black: { remaining: clockState.blackTimeMs },
        },
        turn: clockState.activeColor === 'w' ? 'white' : 'black',
      });
    }
  }
  
  private clockUpdateCallback?: (gameId: string, data: any) => void;
  
  setClockUpdateCallback(callback: (gameId: string, data: any) => void): void {
    this.clockUpdateCallback = callback;
  }
}

export const gameManager = new GameManager();

export default GameManager;
