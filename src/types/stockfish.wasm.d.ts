declare module 'stockfish.wasm' {
  export default function Stockfish(): Promise<{
    postMessage(message: string): void;
    addMessageListener(callback: (message: string) => void): void;
  }>;
}
