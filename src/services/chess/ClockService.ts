import logger from "../../config/logger";

export interface ClockConfig {
  initialTimeMs: number; // Starting time in milliseconds
  incrementMs: number; // Increment per move in milliseconds
}

export interface ClockState {
  whiteTimeMs: number;
  blackTimeMs: number;
  activeColor: "w" | "b" | null;
  lastUpdateTimestamp: number;
}

/**
 * Server-authoritative chess clock service
 * Manages countdown timers, automatic switching, and timeout detection
 */
export class ClockService {
  private gameId: string;
  private config: ClockConfig;
  private state: ClockState;
  private timeoutCallback?: (timedOutColor: "w" | "b") => void;
  private updateCallback?: (state: ClockState) => void;
  private intervalId?: NodeJS.Timeout;

  constructor(
    gameId: string,
    config: ClockConfig,
    timeoutCallback?: (timedOutColor: "w" | "b") => void,
    updateCallback?: (state: ClockState) => void
  ) {
    this.gameId = gameId;
    this.config = config;
    this.timeoutCallback = timeoutCallback;
    this.updateCallback = updateCallback;

    this.state = {
      whiteTimeMs: config.initialTimeMs,
      blackTimeMs: config.initialTimeMs,
      activeColor: null,
      lastUpdateTimestamp: Date.now(),
    };

    logger.debug(`ClockService initialized for game ${gameId}: ${config.initialTimeMs}ms + ${config.incrementMs}ms increment`);
  }

  start(color: "w" | "b"): void {
    if (this.state.activeColor === color) {
      logger.warn(`Clock already running for ${color} in game ${this.gameId}`);
      return;
    }

    if (this.state.activeColor) {
      this.pause();
    }

    this.state.activeColor = color;
    this.state.lastUpdateTimestamp = Date.now();

    this.intervalId = setInterval(() => {
      this.tick();
    }, 100);

    logger.debug(`Clock started for ${color} in game ${this.gameId}`);
  }

  pause(): void {
    if (!this.state.activeColor) {
      return;
    }

    this.updateTime();

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    logger.debug(`Clock paused for ${this.state.activeColor} in game ${this.gameId}`);
    this.state.activeColor = null;
  }

  switchClock(fromColor: "w" | "b"): void {
    if (this.state.activeColor !== fromColor) {
      logger.warn(`Attempted to switch clock from ${fromColor} but active color is ${this.state.activeColor} in game ${this.gameId}`);
      return;
    }

    this.updateTime();
    if (fromColor === "w") {
      this.state.whiteTimeMs += this.config.incrementMs;
    } else {
      this.state.blackTimeMs += this.config.incrementMs;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    const nextColor = fromColor === "w" ? "b" : "w";
    this.start(nextColor);

    logger.debug(`Clock switched from ${fromColor} to ${nextColor} in game ${this.gameId} (+${this.config.incrementMs}ms increment)`);

    if (this.updateCallback) {
      this.updateCallback(this.getState());
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.state.activeColor = null;
    logger.debug(`Clock stopped for game ${this.gameId}`);
  }

  getState(): ClockState {
    if (this.state.activeColor) {
      this.updateTime();
    }
    return { ...this.state };
  }

  restoreState(state: ClockState): void {
    this.state = { ...state };
    if (state.activeColor) {
      this.start(state.activeColor);
    }
    logger.debug(`Clock state restored for game ${this.gameId}`);
  }

  private updateTime(): void {
    if (!this.state.activeColor) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.state.lastUpdateTimestamp;

    if (this.state.activeColor === "w") {
      this.state.whiteTimeMs -= elapsed;
    } else {
      this.state.blackTimeMs -= elapsed;
    }

    this.state.lastUpdateTimestamp = now;
  }

  private tick(): void {
    this.updateTime();

    const currentTime = this.state.activeColor === "w" ? this.state.whiteTimeMs : this.state.blackTimeMs;
    if (currentTime <= 0) {
      logger.warn(`Player ${this.state.activeColor} timed out in game ${this.gameId}`);
      this.stop();

      if (this.timeoutCallback && this.state.activeColor) {
        this.timeoutCallback(this.state.activeColor);
      }
      return;
    }

    if (Date.now() % 1000 < 100 && this.updateCallback) {
      this.updateCallback(this.getState());
    }
  }

  static formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
}

export default ClockService;
