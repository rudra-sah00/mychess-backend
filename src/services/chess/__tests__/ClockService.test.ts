import { ClockService } from "../ClockService";

describe("ClockService", () => {
  jest.setTimeout(10000);

  let clock: ClockService | null = null;

  afterEach(() => {
    // Clean up any running clocks
    if (clock) {
      clock.stop();
      clock = null;
    }
  });

  it("should initialize with correct times", () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 600000, // 10 minutes
      incrementMs: 5000, // 5 seconds
    });

    const state = clock.getState();
    expect(state.whiteTimeMs).toBe(600000);
    expect(state.blackTimeMs).toBe(600000);
    expect(state.activeColor).toBeNull();
  });

  it("should start clock for white", () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 600000,
      incrementMs: 0,
    });

    clock.start("w");
    const state = clock.getState();
    expect(state.activeColor).toBe("w");
  });

  it("should decrement time when clock is running", async () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 5000,
      incrementMs: 0,
    });

    clock.start("w");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const state = clock.getState();
    expect(state.whiteTimeMs).toBeLessThan(5000);
    expect(state.whiteTimeMs).toBeGreaterThan(3000);
  });

  it("should switch clock and add increment", async () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 10000,
      incrementMs: 2000,
    });

    clock.start("w");
    await new Promise((resolve) => setTimeout(resolve, 500));
    clock.switchClock("w");

    const state = clock.getState();
    // White should have time decremented but then incremented
    expect(state.whiteTimeMs).toBeGreaterThan(10000);
    expect(state.activeColor).toBe("b");
  });

  it("should pause clock correctly", async () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 10000,
      incrementMs: 0,
    });

    clock.start("w");
    await new Promise((resolve) => setTimeout(resolve, 500));
    clock.pause();

    const timeAfterPause = clock.getState().whiteTimeMs;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const timeAfterWait = clock.getState().whiteTimeMs;

    expect(timeAfterPause).toEqual(timeAfterWait);
    expect(clock.getState().activeColor).toBeNull();
  });

  it("should call timeout callback when time runs out", (done) => {
    clock = new ClockService(
      "test-game",
      {
        initialTimeMs: 200, // Very short time
        incrementMs: 0,
      },
      (color) => {
        expect(color).toBe("w");
        if (clock) clock.stop();
        done();
      }
    );

    clock.start("w");
  }, 5000);

  it("should restore state correctly", () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 600000,
      incrementMs: 5000,
    });

    clock.restoreState({
      whiteTimeMs: 300000,
      blackTimeMs: 400000,
      activeColor: "b",
      lastUpdateTimestamp: Date.now(),
    });

    const state = clock.getState();
    expect(state.whiteTimeMs).toBe(300000);
    expect(state.blackTimeMs).toBeGreaterThan(390000); // Approximate due to time passing
    expect(state.activeColor).toBe("b");
  });

  it("should format time correctly", () => {
    expect(ClockService.formatTime(600000)).toBe("10:00");
    expect(ClockService.formatTime(61000)).toBe("1:01");
    expect(ClockService.formatTime(5000)).toBe("0:05");
    expect(ClockService.formatTime(0)).toBe("0:00");
  });

  it("should stop clock completely", async () => {
    clock = new ClockService("test-game", {
      initialTimeMs: 10000,
      incrementMs: 0,
    });

    clock.start("w");
    await new Promise((resolve) => setTimeout(resolve, 500));
    clock.stop();

    const state = clock.getState();
    expect(state.activeColor).toBeNull();
  });
});
