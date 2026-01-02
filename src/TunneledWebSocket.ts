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
      payload = new TextDecoder().decode(data)
    } else if (data instanceof Blob) {
      payload = await data.text()
    } else {
      payload = data
    }

    // Encrypt if key is present
    if (this.encryptionKey) {
      payload = await aes.encrypt(payload, this.encryptionKey)
    }

    this.relayerWs.send(payload)
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
    this.errorListeners.forEach(listener => listener(event))
  }

  private handleMessage = async (event: MessageEvent) => {
    try {
      let data = event.data

      // Decrypt if key is present
      if (this.encryptionKey && typeof data === 'string') {
        data = await aes.decrypt(data, this.encryptionKey)
      }

      // Create new MessageEvent with decrypted data
      const newEvent = new MessageEvent('message', {
        data,
        origin: event.origin,
        lastEventId: event.lastEventId,
        source: event.source,
        ports: event.ports as any, // MessagePort[] readonly issue
      })

      this.messageListeners.forEach(listener => listener(newEvent))
    } catch (error) {
      console.error('[TunneledWebSocket] Failed to decrypt message:', error)
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
