/**
 * Type definitions for chess module
 */

export interface JoinGamePayload {
  gameId: string;
}

export interface MakeMovePayload {
  gameId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

export interface DrawOfferPayload {
  gameId: string;
}

export interface DrawResponsePayload {
  gameId: string;
  accept: boolean;
}

export interface ResignPayload {
  gameId: string;
}

export interface JoinMatchmakingPayload {
  rating?: number;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export interface CreateRoomPayload {
  name?: string;
  isPrivate?: boolean;
  password?: string;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export interface JoinRoomPayload {
  roomId: string;
  password?: string;
}

export interface SetReadyPayload {
  isReady: boolean;
  colorPreference?: "white" | "black" | "random";
}

export interface PlayWithBotPayload {
  difficulty: "easy" | "medium" | "hard";
  playerColor?: 'white' | 'black' | 'random';
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export interface SocketResponse<T = void> {
  success: boolean;
  error?: string;
  data?: T;
}
