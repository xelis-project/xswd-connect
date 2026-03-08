/**
 * Encryption key type - 32 bytes (256 bits) encoded as hex string
 */
export type EncryptionKey = string

/**
 * Encryption mode for the relayed connection
 * - AES: AES-256-GCM encryption (recommended)
 * - Chacha20Poly1305: ChaCha20-Poly1305 encryption
 */
export type EncryptionMode = 'aes' | 'chacha20poly1305'
export interface Encryption {
  mode: EncryptionMode
  key: EncryptionKey
}

/**
 * XSWD Application data that identifies the dApp
 */
export interface ApplicationData {
  /** 64-character hex application ID */
  id: string
  /** Application name (max 32 chars) */
  name: string
  /** Application description (max 255 chars) */
  description: string
  /** Application URL (optional, max 255 chars) */
  url?: string
  /** List of RPC method permissions requested */
  permissions: string[]
}

/**
 * QR code data structure that the wallet scans
 */
export interface RelayerQRData {
  /** UUID of the relay channel */
  channel_id: string
  /** Relay server Base URL*/
  endpoint: string
  /** WebSocket URL of the relayer server in full */
  relayer: string
  /** Encryption mode with key (hex encoded) */
  encryption_mode?: Encryption
  /** XSWD application data for the dApp */
  app_data?: ApplicationData
}

/**
 * Configuration options for creating a relayed connection
 */
export interface ConnectionOptions {
  /** Relayer server WebSocket URL (default: official XELIS relayer) */
  relayerUrl?: string
  /** Encryption mode to use (default: AES) */
  encryptionMode?: EncryptionMode
  /** Maximum time to wait for peer connection in milliseconds (default: 120000) */
  timeout?: number
  /** XSWD application data to embed in QR code */
  appData: ApplicationData
  /** Callback when QR code data is ready to display */
  onQRReady?: (qrData: RelayerQRData | null) => void
  /** Callback when peer successfully connects */
  onConnected?: () => void
  /** Callback when connection fails or times out */
  onError?: (error: Error) => void
  /** Callback when connection is closed */
  onClose?: (event: CloseEvent) => void
}

/**
 * The result of createConnection - provides WebSocket-like interface
 */
export interface RelayedConnection {
  /** WebSocket-compatible object that can be passed to XSWD client */
  socket: WebSocketLike
  /** XSWD client with full RPC functionality (.daemon, .wallet, .authorize() etc.) */
  client: any // RelayClient type
  /** QR code data (JSON string) ready for QR generation */
  qrData: string
  /** The parsed QR data object */
  qrDataObj: RelayerQRData
  /** Close the connection and cleanup resources */
  close: () => void
  /** Current connection state */
  readyState: number
  /** Timeout in seconds from the relayer server (for countdown display) */
  timeoutSeconds?: number
}

/**
 * Cancellable connection result - allows cancelling in-flight connections
 */
export interface CancellableConnection {
  /** Promise that resolves when connection is established */
  promise: Promise<RelayedConnection>
  /** Cancel the connection attempt and cleanup resources */
  cancel: () => void
}

/**
 * WebSocket-like interface that XSWD client expects
 */
export interface WebSocketLike {
  send(data: string | ArrayBuffer | Blob): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
  readonly readyState: number
  readonly CONNECTING: number
  readonly OPEN: number
  readonly CLOSING: number
  readonly CLOSED: number
}

/**
 * Internal channel creation message from relayer
 */
export interface ChannelCreationMessage {
  channel_id: string
  /** Timeout in seconds from the relayer server */
  timeout?: number
}
