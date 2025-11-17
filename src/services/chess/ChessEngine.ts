import { Chess, Square, Move, PieceSymbol } from "chess.js";
import logger from "../../config/logger";

export interface MoveResult {
  success: boolean;
  move?: Move;
  error?: string;
  isGameOver?: boolean;
  winner?: "white" | "black" | "draw";
  reason?: "checkmate" | "stalemate" | "threefold" | "insufficient" | "fifty-move" | "resignation" | "timeout" | "agreement";
}

export interface GameState {
  fen: string;
  pgn: string;
  turn: "w" | "b";
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  history: Move[];
  legalMoves: string[];
}

/**
 * Chess engine service wrapping chess.js
 * Provides server-authoritative move validation and game state management
 */
export class ChessEngine {
  private chess: Chess;
  private gameId: string;

  constructor(gameId: string, fen?: string) {
    this.gameId = gameId;
    this.chess = fen ? new Chess(fen) : new Chess();
    logger.debug(`ChessEngine initialized for game ${gameId}${fen ? ` with FEN: ${fen}` : ""}`);
  }

  validateMove(from: string, to: string, promotion?: PieceSymbol, uid?: string, expectedColor?: "w" | "b"): MoveResult {
    try {
      const currentTurn = this.chess.turn();
      if (expectedColor && currentTurn !== expectedColor) {
        logger.warn(`Invalid move attempt by ${uid} in game ${this.gameId}: not player's turn`);
        return { success: false, error: "Not your turn" };
      }

      const move = this.chess.move({
        from: from as Square,
        to: to as Square,
        promotion: promotion as PieceSymbol | undefined,
      });

      if (!move) {
        logger.warn(`Invalid move attempt by ${uid} in game ${this.gameId}: ${from} to ${to}`);
        return { success: false, error: "Illegal move" };
      }

      logger.info(`Valid move in game ${this.gameId}: ${from} to ${to} by ${uid}`);

      const isGameOver = this.chess.isGameOver();
      let winner: "white" | "black" | "draw" | undefined;
      let reason: MoveResult["reason"];

      if (isGameOver) {
        if (this.chess.isCheckmate()) {
          winner = currentTurn === "w" ? "black" : "white";
          reason = "checkmate";
        } else if (this.chess.isStalemate()) {
          winner = "draw";
          reason = "stalemate";
        } else if (this.chess.isThreefoldRepetition()) {
          winner = "draw";
          reason = "threefold";
        } else if (this.chess.isInsufficientMaterial()) {
          winner = "draw";
          reason = "insufficient";
        } else if (this.chess.isDraw()) {
          winner = "draw";
          reason = "fifty-move";
        }

        logger.info(`Game ${this.gameId} ended: ${winner} (${reason})`);
      }

      return {
        success: true,
        move,
        isGameOver,
        winner,
        reason,
      };
    } catch (error) {
      logger.error(`Move validation error in game ${this.gameId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      return { success: false, error: "Invalid move format" };
    }
  }

  getGameState(): GameState {
    return {
      fen: this.chess.fen(),
      pgn: this.chess.pgn(),
      turn: this.chess.turn(),
      isCheck: this.chess.isCheck(),
      isCheckmate: this.chess.isCheckmate(),
      isStalemate: this.chess.isStalemate(),
      isDraw: this.chess.isDraw(),
      isGameOver: this.chess.isGameOver(),
      history: this.chess.history({ verbose: true }),
      legalMoves: this.chess.moves(),
    };
  }

  getLegalMoves(square: string): string[] {
    return this.chess.moves({ square: square as Square, verbose: false });
  }

  getFen(): string {
    return this.chess.fen();
  }

  getPgn(): string {
    return this.chess.pgn();
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  isCheckmate(): boolean {
    return this.chess.isCheckmate();
  }

  loadFen(fen: string): boolean {
    try {
      this.chess.load(fen);
      logger.debug(`Loaded FEN for game ${this.gameId}: ${fen}`);
      return true;
    } catch (error) {
      logger.error(`Failed to load FEN for game ${this.gameId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    }
  }

  reset(): void {
    this.chess.reset();
    logger.debug(`Reset game ${this.gameId} to starting position`);
  }

  handleResignation(resigningColor: "w" | "b"): MoveResult {
    logger.info(`Player ${resigningColor} resigned in game ${this.gameId}`);
    return {
      success: true,
      isGameOver: true,
      winner: resigningColor === "w" ? "black" : "white",
      reason: "resignation",
    };
  }

  handleDrawAgreement(): MoveResult {
    logger.info(`Draw agreed in game ${this.gameId}`);
    return {
      success: true,
      isGameOver: true,
      winner: "draw",
      reason: "agreement",
    };
  }

  handleTimeout(timedOutColor: "w" | "b"): MoveResult {
    logger.info(`Player ${timedOutColor} timed out in game ${this.gameId}`);
    return {
      success: true,
      isGameOver: true,
      winner: timedOutColor === "w" ? "black" : "white",
      reason: "timeout",
    };
  }
}

export default ChessEngine;
