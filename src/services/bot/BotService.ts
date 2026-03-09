import * as fs from 'fs';
import * as path from 'path';
import logger from '../../config/logger';

const engineDir = path.join(__dirname, '../../../node_modules/stockfish/src');

// Stockfish v17 ships with hash-named files; pick the best variant for Node.js
function resolveEngineFile(): string {
  const files = fs.readdirSync(engineDir);
  const pick = (pattern: RegExp) => files.find(f => pattern.test(f));
  const js =
    pick(/stockfish.*lite-single.*\.js$/) ??  // preferred: lite + single-threaded
    pick(/stockfish.*single.*\.js$/) ??        // fallback: single-threaded full
    pick(/stockfish.*asm.*\.js$/) ??           // fallback: asm.js (no wasm)
    pick(/stockfish.*\.js$/);                  // last resort: any JS
  if (!js) throw new Error(`No stockfish JS file found in ${engineDir}`);
  logger.info(`[Bot] Using stockfish engine: ${js}`);
  return path.join(engineDir, js);
}

const enginePath = resolveEngineFile();

export type BotDifficulty = 'easy' | 'medium' | 'hard';

interface BotConfig {
  depth: number;
  skillLevel: number;
  moveTime?: number;
}

export class BotService {
  private engine: any;
  private engineConfig: any;
  private isReady: boolean = false;
  private difficulty: BotDifficulty;
  private config: BotConfig;
  private currentFen: string = '';
  private pendingMoveResolver: ((move: string) => void) | null = null;

  constructor(difficulty: BotDifficulty = 'medium') {
    this.difficulty = difficulty;
    this.config = this.getDifficultyConfig(difficulty);
  }

  private getDifficultyConfig(difficulty: BotDifficulty): BotConfig {
    switch (difficulty) {
      case 'easy': return { depth: 1, skillLevel: 1, moveTime: 500 };
      case 'medium': return { depth: 5, skillLevel: 10, moveTime: 1000 };
      case 'hard': return { depth: 15, skillLevel: 20, moveTime: 2000 };
    }
  }

  async initialize(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      this.isReady = true;
      this.engine = {
        sendCommand: (cmd: string) => {
          if (cmd.startsWith('go')) {
            setTimeout(() => {
              if (this.engineConfig && this.engineConfig.print) {
                this.engineConfig.print('bestmove e2e4');
              } else if (this.pendingMoveResolver) {
                this.pendingMoveResolver('e2e4');
                this.pendingMoveResolver = null;
              }
            }, 10);
          }
        }
      };
      logger.info(`[Bot] Mock Stockfish initialized for testing`);
      return Promise.resolve();
    }

    try {
      const resolvedPath = require.resolve(enginePath);
      if (resolvedPath in require.cache) delete require.cache[resolvedPath];
      // require(enginePath) returns the outer factory `t`.
      // Calling t() returns the Emscripten inner factory `e`.
      // Only calling e(config) initializes the engine and returns config.ready (a Promise).
      const outerFactory = require(enginePath);
      const EngineFactory = outerFactory();
      // The wasm file has the same base name as the JS file
      const wasmPath = enginePath.replace(/\.js$/, '.wasm');

      return new Promise<void>((resolve, reject) => {
        let runtimeInitialized = false;

        this.engineConfig = {
          locateFile: (file: string) => wasmPath,
          onRuntimeInitialized: () => {
            logger.debug('[Bot] onRuntimeInitialized called');
            runtimeInitialized = true;
          },
          print: (line: string) => {
            const trimmedLine = line.trim();
            logger.debug(`[Bot] Stockfish: ${trimmedLine}`);

            if (trimmedLine === 'uciok') {
              this.isReady = true;
              logger.info(`[Bot] Stockfish initialized (${this.difficulty})`);
            }

            if (trimmedLine.startsWith('bestmove')) {
              const match = trimmedLine.match(/bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/);
              if (match && this.pendingMoveResolver) {
                const move = match[1];
                logger.debug(`[Bot] Best move found: ${move}`);
                this.pendingMoveResolver(move);
                this.pendingMoveResolver = null;
              }
            }
          }
        };

        if (fs.existsSync(wasmPath)) {
          this.engineConfig.wasmBinary = fs.readFileSync(wasmPath);
        }

        const result = EngineFactory(this.engineConfig);

        const setupEngine = (engineInstance: any) => {
          this.engine = engineInstance || this.engineConfig;

          this.engine.sendCommand = (cmd: string) => {
            const target = this.engine;
            const config = this.engineConfig;

            const methods = [
              { obj: target, name: 'ccall', type: 'ccall' },
              { obj: config, name: 'ccall', type: 'ccall' },
              { obj: target, name: '_command', type: 'direct' },
              { obj: config, name: '_command', type: 'direct' },
              { obj: config, name: 'processCommand', type: 'direct' },
              { obj: target, name: 'postMessage', type: 'direct' }
            ];

            for (const m of methods) {
              if (m.obj && m.obj[m.name]) {
                try {
                  if (m.type === 'ccall') {
                    m.obj[m.name]('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });
                  } else {
                    m.obj[m.name](cmd);
                  }
                  return;
                } catch (e: any) {
                  logger.debug(`[Bot] Method ${m.name} failed: ${e.message}`);
                }
              }
            }
            logger.error(`[Bot] No method to send command: ${cmd}`);
          };

          const checkReady = setInterval(() => {
            if (runtimeInitialized || (this.engine && this.engine.ccall) || (this.engineConfig && this.engineConfig.ccall) || (this.engineConfig && this.engineConfig.processCommand)) {
              clearInterval(checkReady); // prevent sending 'uci' more than once
              this.engine.sendCommand('uci');

              const checkUciOk = setInterval(() => {
                if (this.isReady) {
                  clearInterval(checkUciOk);
                  clearTimeout(timeout);
                  this.engine.sendCommand(`setoption name Skill Level value ${this.config.skillLevel}`);
                  this.engine.sendCommand('isready');
                  resolve();
                }
              }, 100);
            }
          }, 100);

          const timeout = setTimeout(() => {
            clearInterval(checkReady);
            reject(new Error('Stockfish initialization timeout'));
          }, 45000);
        };

        if (result && typeof result.then === 'function') {
          result.then(setupEngine).catch(reject);
        } else {
          setupEngine(result);
        }
      });

    } catch (error) {
      logger.error('[Bot] Failed to initialize Stockfish:', error);
      throw error;
    }
  }

  async getBestMove(fen: string): Promise<string> {
    if (!this.isReady) throw new Error('Stockfish engine not ready');
    this.currentFen = fen;

    return new Promise((resolve, reject) => {
      this.pendingMoveResolver = resolve;

      try {
        this.engine.sendCommand(`position fen ${fen}`);
        const moveCmd = this.config.moveTime
          ? `go movetime ${this.config.moveTime}`
          : `go depth ${this.config.depth}`;
        this.engine.sendCommand(moveCmd);
      } catch (e: any) {
        reject(new Error(`Failed to send move command: ${e.message}`));
        return;
      }

      setTimeout(() => {
        if (this.pendingMoveResolver) {
          this.pendingMoveResolver = null;
          reject(new Error('Bot move timeout'));
        }
      }, (this.config.moveTime || 3000) + 40000);
    });
  }

  terminate(): void {
    if (this.engine && this.engine.sendCommand) {
      try { this.engine.sendCommand('quit'); } catch (e) { }
    }
    this.isReady = false;
    logger.info('[Bot] Stockfish terminated');
  }

  getDifficulty(): BotDifficulty { return this.difficulty; }
  ready(): boolean { return this.isReady; }
}

export class BotManager {
  private bots: Map<string, BotService> = new Map();

  async createBot(gameId: string, difficulty: BotDifficulty): Promise<BotService> {
    if (this.bots.has(gameId)) return this.bots.get(gameId)!;
    const bot = new BotService(difficulty);
    await bot.initialize();
    this.bots.set(gameId, bot);
    logger.info(`[BotManager] Created ${difficulty} bot for game ${gameId}`);
    return bot;
  }

  getBot(gameId: string): BotService | undefined { return this.bots.get(gameId); }

  removeBot(gameId: string): void {
    const bot = this.bots.get(gameId);
    if (bot) {
      bot.terminate();
      this.bots.delete(gameId);
      logger.info(`[BotManager] Removed bot for game ${gameId}`);
    }
  }

  getActiveBotGames(): string[] { return Array.from(this.bots.keys()); }

  terminateAll(): void {
    for (const bot of this.bots.values()) { bot.terminate(); }
    this.bots.clear();
    logger.info('[BotManager] All bots terminated');
  }
}
