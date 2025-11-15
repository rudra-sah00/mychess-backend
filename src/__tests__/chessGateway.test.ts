import { registerChessNamespace } from "../modules/chess";

describe("registerChessNamespace", () => {
  it("should be a function", () => {
    expect(typeof registerChessNamespace).toBe("function");
  });
});
