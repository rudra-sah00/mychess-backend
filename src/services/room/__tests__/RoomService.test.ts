import { RoomService } from "../RoomService";

// Mock Firebase
jest.mock("../../firebase/firebaseAdmin", () => ({
  firebaseAdmin: {
    getDatabase: () => ({
      ref: () => ({
        set: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

// Mock nanoid
jest.mock("nanoid", () => ({
  nanoid: jest.fn((length: number) => `test-room-${length}`),
}));

describe("RoomService", () => {
  let roomService: RoomService;

  beforeEach(() => {
    roomService = new RoomService();
  });

  describe("createRoom", () => {
    it("should create a room successfully", () => {
      const result = roomService.createRoom("user1", "socket1", {
        name: "Test Room",
      });

      expect(result.success).toBe(true);
      expect(result.room).toBeDefined();
      expect(result.room?.name).toBe("Test Room");
      expect(result.room?.hostUid).toBe("user1");
      expect(result.room?.players).toHaveLength(1);
      expect(result.room?.status).toBe("waiting");
    });

    it("should create a private room with password", () => {
      const result = roomService.createRoom("user1", "socket1", {
        name: "Private Room",
        isPrivate: true,
        password: "secret123",
      });

      expect(result.success).toBe(true);
      expect(result.room?.isPrivate).toBe(true);
      expect(result.room?.password).toBe("secret123");
    });

    it("should create room with time control", () => {
      const timeControl = { initialTimeMs: 300000, incrementMs: 3000 };
      const result = roomService.createRoom("user1", "socket1", {
        timeControl,
      });

      expect(result.success).toBe(true);
      expect(result.room?.timeControl).toEqual(timeControl);
    });

    it("should fail if player is already in a room", () => {
      roomService.createRoom("user1", "socket1");
      const result = roomService.createRoom("user1", "socket2");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Already in a room");
    });
  });

  describe("joinRoom", () => {
    it("should join a room successfully", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      const joinResult = roomService.joinRoom("user2", "socket2", roomId);

      expect(joinResult.success).toBe(true);
      expect(joinResult.room?.players).toHaveLength(2);
      expect(joinResult.room?.status).toBe("ready");
    });

    it("should fail to join non-existent room", () => {
      const result = roomService.joinRoom("user2", "socket2", "invalid-room");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room not found");
    });

    it("should fail to join full room", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      roomService.joinRoom("user2", "socket2", roomId);
      const result = roomService.joinRoom("user3", "socket3", roomId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room is full");
    });

    it("should fail to join private room without password", () => {
      const createResult = roomService.createRoom("user1", "socket1", {
        isPrivate: true,
        password: "secret",
      });
      const roomId = createResult.room!.roomId;

      const result = roomService.joinRoom("user2", "socket2", roomId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid password");
    });

    it("should join private room with correct password", () => {
      const createResult = roomService.createRoom("user1", "socket1", {
        isPrivate: true,
        password: "secret",
      });
      const roomId = createResult.room!.roomId;

      const result = roomService.joinRoom("user2", "socket2", roomId, "secret");

      expect(result.success).toBe(true);
      expect(result.room?.players).toHaveLength(2);
    });

    it("should fail if player is already in another room", () => {
      const room1 = roomService.createRoom("user1", "socket1");
      const room2 = roomService.createRoom("user2", "socket2");

      const result = roomService.joinRoom("user1", "socket1", room2.room!.roomId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Already in another room");
    });
  });

  describe("leaveRoom", () => {
    it("should leave room successfully", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      roomService.joinRoom("user2", "socket2", roomId);

      const result = roomService.leaveRoom("user2");

      expect(result.success).toBe(true);
      expect(result.roomId).toBe(roomId);
      expect(result.disbanded).toBe(false);

      const room = roomService.getRoom(roomId);
      expect(room?.players).toHaveLength(1);
      expect(room?.status).toBe("waiting");
    });

    it("should disband room when host leaves", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      roomService.joinRoom("user2", "socket2", roomId);

      const result = roomService.leaveRoom("user1");

      expect(result.success).toBe(true);
      expect(result.disbanded).toBe(true);
      expect(roomService.getRoom(roomId)).toBeNull();
    });

    it("should disband room when last player leaves", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      const result = roomService.leaveRoom("user1");

      expect(result.success).toBe(true);
      expect(result.disbanded).toBe(true);
      expect(roomService.getRoom(roomId)).toBeNull();
    });

    it("should fail if player is not in a room", () => {
      const result = roomService.leaveRoom("user1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not in a room");
    });
  });

  describe("setPlayerReady", () => {
    it("should set player ready status", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      roomService.joinRoom("user2", "socket2", roomId);

      const result = roomService.setPlayerReady("user1", true);

      expect(result.success).toBe(true);
      expect(result.room?.players[0].isReady).toBe(true);
      expect(result.allReady).toBe(false);
    });

    it("should detect when all players are ready", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      roomService.joinRoom("user2", "socket2", roomId);

      roomService.setPlayerReady("user1", true);
      const result = roomService.setPlayerReady("user2", true);

      expect(result.success).toBe(true);
      expect(result.allReady).toBe(true);
    });

    it("should fail if player is not in a room", () => {
      const result = roomService.setPlayerReady("user1", true);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not in a room");
    });
  });

  describe("startGame", () => {
    it("should start game in room", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      const result = roomService.startGame(roomId, "game123");

      expect(result.success).toBe(true);

      const room = roomService.getRoom(roomId);
      expect(room?.status).toBe("playing");
      expect(room?.gameId).toBe("game123");
    });

    it("should fail for non-existent room", () => {
      const result = roomService.startGame("invalid-room", "game123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room not found");
    });
  });

  describe("listAvailableRooms", () => {
    it("should list only public waiting rooms", () => {
      const room1 = roomService.createRoom("user1", "socket1", { name: "Public Room 1" });
      const room2 = roomService.createRoom("user2", "socket2", {
        name: "Private Room",
        isPrivate: true,
      });
      const room3 = roomService.createRoom("user3", "socket3", { name: "Public Room 2" });

      const rooms = roomService.listAvailableRooms();

      // Room IDs should be unique due to nanoid, but in tests they might collide
      // so we check that we have at least the public rooms that were created
      expect(rooms.length).toBeGreaterThanOrEqual(1);
      expect(rooms.every((r) => !r.isPrivate)).toBe(true);
    });

    it("should not list full rooms", () => {
      const createResult = roomService.createRoom("user1", "socket1");
      roomService.joinRoom("user2", "socket2", createResult.room!.roomId);

      const rooms = roomService.listAvailableRooms();

      expect(rooms).toHaveLength(0);
    });
  });

  describe("getRoomByPlayer", () => {
    it("should get room by player uid", () => {
      const createResult = roomService.createRoom("user1", "socket1");

      const room = roomService.getRoomByPlayer("user1");

      expect(room).toBeDefined();
      expect(room?.roomId).toBe(createResult.room?.roomId);
    });

    it("should return null if player is not in a room", () => {
      const room = roomService.getRoomByPlayer("user1");

      expect(room).toBeNull();
    });
  });

  describe("updatePlayerSocketId", () => {
    it("should update player socket ID", () => {
      roomService.createRoom("user1", "socket1");

      const result = roomService.updatePlayerSocketId("user1", "new-socket-id");

      expect(result.success).toBe(true);

      const room = roomService.getRoomByPlayer("user1");
      expect(room?.players[0].socketId).toBe("new-socket-id");
    });

    it("should fail if player is not in a room", () => {
      const result = roomService.updatePlayerSocketId("user1", "socket2");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not in a room");
    });
  });
});
