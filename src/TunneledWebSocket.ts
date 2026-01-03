import type { EncryptionMode, WebSocketLike } from './types'
import * as aes from './crypto/aes'

/**
 * Wraps a relay WebSocket connection with optional encryption
 * Provides WebSocket-like interface that XSWD client can use
 */
export class TunneledWebSocket implements WebSocketLike {
  private relayerWs: WebSocket
  private encryptionKey?: CryptoKey
  private messageListeners: Set<EventListener> = new Set()
  private openListeners: Set<EventListener> = new Set()
  private closeListeners: Set<EventListener> = new Set()
  private errorListeners: Set<EventListener> = new Set()

  readonly CONNECTING = WebSocket.CONNECTING
  readonly OPEN = WebSocket.OPEN
  readonly CLOSING = WebSocket.CLOSING
  readonly CLOSED = WebSocket.CLOSED

  constructor(relayerWs: WebSocket, encryptionKey?: CryptoKey) {
    this.relayerWs = relayerWs
    this.encryptionKey = encryptionKey

    // Forward events from relayer WebSocket
    this.relayerWs.addEventListener('open', this.handleOpen)
    this.relayerWs.addEventListener('close', this.handleClose)
    this.relayerWs.addEventListener('error', this.handleError)
    this.relayerWs.addEventListener('message', this.handleMessage)
  }

  get readyState(): number {
    return this.relayerWs.readyState
  }

  async send(data: string | ArrayBuffer | Blob): Promise<void> {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }

    let payload: string

    // Convert to string if needed
    if (data instanceof ArrayBuffer) {
      console.log('[TunneledWebSocket] send: Converting ArrayBuffer to string')
      payload = new TextDecoder().decode(data)
    } else if (data instanceof Blob) {
      console.log('[TunneledWebSocket] send: Converting Blob to string')
      payload = await data.text()
    } else {
      payload = data
    }

    console.log('[TunneledWebSocket] send: Payload preview:', payload.substring(0, 100))

    // Encrypt if key is present
    if (this.encryptionKey) {
      console.log('[TunneledWebSocket] send: Encrypting payload')
      const encryptedBytes = await aes.encryptBytes(payload, this.encryptionKey)
      console.log('[TunneledWebSocket] send: Encrypted bytes length:', encryptedBytes.length)
      console.log('[TunneledWebSocket] send: Sending binary to relayer')
      this.relayerWs.send(encryptedBytes.buffer)
    } else {
      console.log('[TunneledWebSocket] send: Sending plaintext to relayer')
      this.relayerWs.send(payload)
    }
  }

  close(code?: number, reason?: string): void {
    this.relayerWs.close(code, reason)
  }

  addEventListener(type: string, listener: EventListener): void {
    switch (type) {
      case 'message':
        this.messageListeners.add(listener)
        break
      case 'open':
        this.openListeners.add(listener)
        break
      case 'close':
        this.closeListeners.add(listener)
        break
      case 'error':
        this.errorListeners.add(listener)
        break
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    switch (type) {
      case 'message':
        this.messageListeners.delete(listener)
        break
      case 'open':
        this.openListeners.delete(listener)
        break
      case 'close':
        this.closeListeners.delete(listener)
        break
      case 'error':
        this.errorListeners.delete(listener)
        break
    }
  }

  private handleOpen = (event: Event) => {
    this.openListeners.forEach(listener => listener(event))
  }

  private handleClose = (event: Event) => {
    this.closeListeners.forEach(listener => listener(event))
    this.cleanup()
  }

  private handleError = (event: Event) => {
    console.error('[TunneledWebSocket] WebSocket error:', event)
    this.errorListeners.forEach(listener => listener(event))
  }

  private handleMessage = async (event: MessageEvent) => {
    try {
      let data = event.data
      console.log('[TunneledWebSocket] Received message, type:', typeof data, 'instance:', data?.constructor?.name, 'encrypted:', !!this.encryptionKey)

      // Decrypt if key is present
      if (this.encryptionKey) {
        if (typeof data === 'string') {
          console.log('[TunneledWebSocket] Decrypting text message, length:', data.length)
          // Text message with base64-encoded ciphertext (from dApp)
          data = await aes.decrypt(data, this.encryptionKey)
          console.log('[TunneledWebSocket] Text message decrypted successfully')
        } else if (data instanceof ArrayBuffer) {
          console.log('[TunneledWebSocket] Decrypting binary ArrayBuffer message, length:', data.byteLength)
          // Binary message with raw bytes (from wallet) - convert to base64 first
          const uint8Array = new Uint8Array(data)
          const base64 = btoa(String.fromCharCode(...uint8Array))
          console.log('[TunneledWebSocket] Converted to base64, length:', base64.length)
          data = await aes.decrypt(base64, this.encryptionKey)
          console.log('[TunneledWebSocket] Binary message decrypted successfully')
        } else if (data instanceof Blob) {
          console.log('[TunneledWebSocket] Decrypting Blob message, size:', data.size)
          // Blob message - convert to base64 first
          const arrayBuffer = await data.arrayBuffer()
          const uint8Array = new Uint8Array(arrayBuffer)
          const base64 = btoa(String.fromCharCode(...uint8Array))
          console.log('[TunneledWebSocket] Converted blob to base64, length:', base64.length)
          data = await aes.decrypt(base64, this.encryptionKey)
          console.log('[TunneledWebSocket] Blob message decrypted successfully')
          console.log('[TunneledWebSocket] Decrypted data type:', typeof data, 'preview:', data?.substring?.(0, 100))
        } else {
          console.warn('[TunneledWebSocket] Unknown message type:', data)
        }
      }

      console.log('[TunneledWebSocket] Final data type before forwarding:', typeof data)
      console.log('[TunneledWebSocket] Forwarding decrypted message to', this.messageListeners.size, 'listeners')

      // Create new MessageEvent with decrypted data
      const newEvent = new MessageEvent('message', {
        data,
        origin: event.origin,
        lastEventId: event.lastEventId,
        source: event.source,
        ports: event.ports as any, // MessagePort[] readonly issue
      })

      console.log('[TunneledWebSocket] newEvent.data type:', typeof newEvent.data)
      console.log('[TunneledWebSocket] newEvent.data preview:', typeof newEvent.data === 'string' ? newEvent.data.substring(0, 100) : newEvent.data)

      this.messageListeners.forEach(listener => listener(newEvent))
    } catch (error) {
      console.error('[TunneledWebSocket] Failed to decrypt message:', error)
      console.error('[TunneledWebSocket] Message data type:', typeof event.data)
      console.error('[TunneledWebSocket] Error stack:', error instanceof Error ? error.stack : 'N/A')
      // Forward as error event
      const errorEvent = new ErrorEvent('error', {
        error,
        message: 'Decryption failed',
      })
      this.errorListeners.forEach(listener => listener(errorEvent))
    }
  }

  private cleanup(): void {
    this.relayerWs.removeEventListener('open', this.handleOpen)
    this.relayerWs.removeEventListener('close', this.handleClose)
    this.relayerWs.removeEventListener('error', this.handleError)
    this.relayerWs.removeEventListener('message', this.handleMessage)

    this.messageListeners.clear()
    this.openListeners.clear()
    this.closeListeners.clear()
    this.errorListeners.clear()
  }
}
