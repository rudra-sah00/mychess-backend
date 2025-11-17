import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRoutes from "../auth";
import { firebaseAdmin } from "../../services/firebase/firebaseAdmin";

// Mock Firebase Admin
jest.mock("../../services/firebase/firebaseAdmin", () => ({
  firebaseAdmin: {
    verifyIdToken: jest.fn(),
    createSessionCookie: jest.fn(),
    verifySessionCookie: jest.fn(),
    revokeRefreshTokens: jest.fn(),
  },
}));

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  return app;
};

describe("Auth Routes", () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe("POST /api/auth/google", () => {
    it("should create session cookie from ID token in body", async () => {
      const mockToken = "mock-id-token";
      const mockUid = "user-123";
      const mockSessionCookie = "mock-session-cookie";

      (firebaseAdmin.verifyIdToken as jest.Mock).mockResolvedValue({
        uid: mockUid,
        email: "test@example.com",
      });
      (firebaseAdmin.createSessionCookie as jest.Mock).mockResolvedValue(mockSessionCookie);

      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: mockToken });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        uid: mockUid,
        expiresIn: 14 * 24 * 60 * 60 * 1000,
      });
      expect(response.headers["set-cookie"]).toBeDefined();
      expect(firebaseAdmin.verifyIdToken).toHaveBeenCalledWith(mockToken);
      expect(firebaseAdmin.createSessionCookie).toHaveBeenCalledWith(
        mockToken,
        14 * 24 * 60 * 60 * 1000
      );
    });

    it("should create session cookie from Bearer token", async () => {
      const mockToken = "mock-bearer-token";
      const mockUid = "user-456";
      const mockSessionCookie = "mock-session-cookie";

      (firebaseAdmin.verifyIdToken as jest.Mock).mockResolvedValue({
        uid: mockUid,
      });
      (firebaseAdmin.createSessionCookie as jest.Mock).mockResolvedValue(mockSessionCookie);

      const response = await request(app)
        .post("/api/auth/google")
        .set("Authorization", `Bearer ${mockToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.uid).toBe(mockUid);
      expect(firebaseAdmin.verifyIdToken).toHaveBeenCalledWith(mockToken);
    });

    it("should return 400 when idToken is missing", async () => {
      const response = await request(app)
        .post("/api/auth/google")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "idToken is required" });
    });

    it("should return 401 when token verification fails", async () => {
      (firebaseAdmin.verifyIdToken as jest.Mock).mockRejectedValue(
        new Error("Invalid token")
      );

      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: "invalid-token" });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid token");
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("should refresh session cookie", async () => {
      const mockSessionCookie = "existing-session";
      const mockNewCookie = "new-session";
      const mockUid = "user-123";

      (firebaseAdmin.verifySessionCookie as jest.Mock).mockResolvedValue({
        uid: mockUid,
      });
      (firebaseAdmin.createSessionCookie as jest.Mock).mockResolvedValue(mockNewCookie);

      const response = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", [`session=${mockSessionCookie}`]);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        uid: mockUid,
        expiresIn: 14 * 24 * 60 * 60 * 1000,
      });
      expect(firebaseAdmin.verifySessionCookie).toHaveBeenCalledWith(mockSessionCookie);
    });

    it("should return 401 when no session cookie", async () => {
      const response = await request(app)
        .post("/api/auth/refresh")
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "no session found" });
    });

    it("should clear cookie and return 401 on invalid session", async () => {
      (firebaseAdmin.verifySessionCookie as jest.Mock).mockRejectedValue(
        new Error("Session expired")
      );

      const response = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", ["session=invalid"]);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Session expired");
      expect(response.headers["set-cookie"]).toBeDefined();
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should logout and revoke refresh tokens", async () => {
      const mockSessionCookie = "existing-session";
      const mockUid = "user-123";

      (firebaseAdmin.verifySessionCookie as jest.Mock).mockResolvedValue({
        uid: mockUid,
      });
      (firebaseAdmin.revokeRefreshTokens as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [`session=${mockSessionCookie}`]);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(firebaseAdmin.revokeRefreshTokens).toHaveBeenCalledWith(mockUid);
    });

    it("should clear cookie even when no session exists", async () => {
      const response = await request(app)
        .post("/api/auth/logout")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(firebaseAdmin.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it("should clear cookie even when verification fails", async () => {
      (firebaseAdmin.verifySessionCookie as jest.Mock).mockRejectedValue(
        new Error("Invalid session")
      );

      const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", ["session=invalid"]);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });
  });

  describe("GET /api/auth/status", () => {
    it("should return authenticated status for valid session", async () => {
      const mockSessionCookie = "valid-session";
      const mockUid = "user-123";
      const mockEmail = "test@example.com";
      const mockExp = Math.floor(Date.now() / 1000) + 3600;

      (firebaseAdmin.verifySessionCookie as jest.Mock).mockResolvedValue({
        uid: mockUid,
        email: mockEmail,
        exp: mockExp,
      });

      const response = await request(app)
        .get("/api/auth/status")
        .set("Cookie", [`session=${mockSessionCookie}`]);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticated: true,
        uid: mockUid,
        email: mockEmail,
        expiresAt: mockExp * 1000,
      });
    });

    it("should return unauthenticated when no session cookie", async () => {
      const response = await request(app)
        .get("/api/auth/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ authenticated: false });
    });

    it("should return unauthenticated and clear cookie on invalid session", async () => {
      (firebaseAdmin.verifySessionCookie as jest.Mock).mockRejectedValue(
        new Error("Invalid session")
      );

      const response = await request(app)
        .get("/api/auth/status")
        .set("Cookie", ["session=invalid"]);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ authenticated: false });
      expect(response.headers["set-cookie"]).toBeDefined();
    });
  });
});
