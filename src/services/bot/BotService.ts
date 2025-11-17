import Stockfish from 'stockfish.wasm';
import logger from '../../config/logger';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

interface BotConfig {
  depth: number;
  skillLevel: number;
  moveTime?: number;
}

/**
 * BotService handles chess bot gameplay using Stockfish engine
 * Supports multiple difficulty levels (easy, medium, hard)
 */
export class BotService {
  private engine: any;
  private isReady: boolean = false;
  private difficulty: BotDifficulty;
  private config: BotConfig;
  private currentFen: string = '';
  private pendingMoveResolver: ((move: string) => void) | null = null;

  constructor(difficulty: BotDifficulty = 'medium') {
    this.difficulty = difficulty;
    this.config = this.getDifficultyConfig(difficulty);
  }

  /**
   * Get configuration based on difficulty level
   */
  private getDifficultyConfig(difficulty: BotDifficulty): BotConfig {
    switch (difficulty) {
      case 'easy':
        return {
          depth: 1,
          skillLevel: 1,
          moveTime: 500,
        };
      case 'medium':
        return {
          depth: 5,
          skillLevel: 10,
          moveTime: 1000,
        };
      case 'hard':
        return {
          depth: 15,
          skillLevel: 20,
          moveTime: 2000,
        };
    }
  }

  /**
   * Initialize the Stockfish engine
   */
  async initialize(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this.engine = await Stockfish();
        
        this.engine.addMessageListener((message: string) => {
          logger.debug(`[Bot] Stockfish: ${message}`);
          
          if (message === 'uciok') {
            this.isReady = true;
            logger.info(`[Bot] Stockfish initialized (${this.difficulty})`);
          }
          
          // Extract best move from engine output
          if (message.startsWith('bestmove')) {
            const match = message.match(/bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/);
            if (match && this.pendingMoveResolver) {
              const move = match[1];
              logger.debug(`[Bot] Best move found: ${move}`);
              this.pendingMoveResolver(move);
              this.pendingMoveResolver = null;
            }
          }
        });

        // Initialize UCI protocol
        this.engine.postMessage('uci');
        
        // Wait for engine to be ready
        const timeout = setTimeout(() => {
          reject(new Error('Stockfish initialization timeout'));
        }, 5000);

        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            
            // Set skill level and options
            this.engine.postMessage(`setoption name Skill Level value ${this.config.skillLevel}`);
            this.engine.postMessage('isready');
            
            resolve();
          }
        }, 100);
      } catch (error) {
        logger.error('[Bot] Failed to initialize Stockfish:', error);
        reject(error);
      }
    });
  }

  /**
   * Get the best move for the current position
   */
  async getBestMove(fen: string): Promise<string> {
    if (!this.isReady) {
      throw new Error('Stockfish engine not ready');
    }

    this.currentFen = fen;

    return new Promise((resolve, reject) => {
      this.pendingMoveResolver = resolve;

      // Set position
      this.engine.postMessage(`position fen ${fen}`);
      
      // Start calculating
      if (this.config.moveTime) {
        this.engine.postMessage(`go movetime ${this.config.moveTime}`);
      } else {
        this.engine.postMessage(`go depth ${this.config.depth}`);
      }

      // Timeout fallback
      setTimeout(() => {
        if (this.pendingMoveResolver) {
          this.pendingMoveResolver = null;
          reject(new Error('Bot move timeout'));
        }
      }, (this.config.moveTime || 3000) + 2000);
    });
  }

  /**
   * Terminate the engine
   */
  terminate(): void {
    if (this.engine) {
      this.engine.postMessage('quit');
      this.isReady = false;
      logger.info('[Bot] Stockfish terminated');
    }
  }

  /**
   * Get current difficulty level
   */
  getDifficulty(): BotDifficulty {
    return this.difficulty;
  }

  /**
   * Check if engine is ready
   */
  ready(): boolean {
    return this.isReady;
  }
}

/**
 * BotManager manages multiple bot instances for different games
 */
export class BotManager {
  private bots: Map<string, BotService> = new Map();

  /**
   * Create a new bot for a game
   */
  async createBot(gameId: string, difficulty: BotDifficulty): Promise<BotService> {
    if (this.bots.has(gameId)) {
      logger.warn(`[BotManager] Bot already exists for game ${gameId}`);
      return this.bots.get(gameId)!;
    }

    const bot = new BotService(difficulty);
    await bot.initialize();
    
    this.bots.set(gameId, bot);
    logger.info(`[BotManager] Created ${difficulty} bot for game ${gameId}`);
    
    return bot;
  }

  /**
   * Get bot for a game
   */
  getBot(gameId: string): BotService | undefined {
    return this.bots.get(gameId);
  }

  /**
   * Remove bot for a game
   */
  removeBot(gameId: string): void {
    const bot = this.bots.get(gameId);
    if (bot) {
      bot.terminate();
      this.bots.delete(gameId);
      logger.info(`[BotManager] Removed bot for game ${gameId}`);
    }
  }

  /**
   * Get all active bot game IDs
   */
  getActiveBotGames(): string[] {
    return Array.from(this.bots.keys());
  }

  /**
   * Terminate all bots
   */
  terminateAll(): void {
    for (const [gameId, bot] of this.bots) {
      bot.terminate();
    }
    this.bots.clear();
    logger.info('[BotManager] All bots terminated');
  }
}
