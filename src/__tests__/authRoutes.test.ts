import request from "supertest";
import { createHttpServer } from "../app";
import * as firebaseAdmin from "../services/firebaseAdmin";

jest.mock("../services/firebaseAdmin");

describe("Auth Routes", () => {
  const serverBundle = createHttpServer();
  const { app, httpServer } = serverBundle;

  afterAll(() => {
    httpServer.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/auth/google", () => {
    it("creates session cookie and returns uid", async () => {
      (firebaseAdmin.verifyIdToken as jest.Mock).mockResolvedValue({
        uid: "test-uid",
        email: "test@example.com",
      });
      (firebaseAdmin.createSessionCookie as jest.Mock).mockResolvedValue(
        "session-cookie-value"
      );

      const res = await request(app)
        .post("/api/auth/google")
        .send({ idToken: "valid-id-token" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        uid: "test-uid",
        expiresIn: 14 * 24 * 60 * 60 * 1000,
      });
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("returns 400 when idToken missing", async () => {
      const res = await request(app).post("/api/auth/google").send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "idToken is required" });
    });
  });

  describe("GET /api/auth/status", () => {
    it("returns authenticated false when no cookie", async () => {
      const res = await request(app).get("/api/auth/status");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });

    it("returns user info when session valid", async () => {
      (firebaseAdmin.verifySessionCookie as jest.Mock).mockResolvedValue({
        uid: "test-uid",
        email: "test@example.com",
        exp: 1700000000,
      });

      const res = await request(app)
        .get("/api/auth/status")
        .set("Cookie", ["session=valid-session-cookie"]);

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.uid).toBe("test-uid");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears cookie and returns success", async () => {
      (firebaseAdmin.verifySessionCookie as jest.Mock).mockResolvedValue({
        uid: "test-uid",
      });
      (firebaseAdmin.revokeRefreshTokens as jest.Mock).mockResolvedValue(
        undefined
      );

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", ["session=valid-cookie"]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });
});
