import type { WebSocketLike } from './types'
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

  // Serialize async encryption / blob conversion while keeping send() sync outward.
  private sendChain: Promise<void> = Promise.resolve()

  // Serialize inbound decrypt/forward to preserve message ordering.
  private recvChain: Promise<void> = Promise.resolve()

  // WebSocket-style handler properties (some libs use these instead of addEventListener).
  private _onopen: ((e: Event) => any) | null = null
  private _onmessage: ((e: MessageEvent) => any) | null = null
  private _onclose: ((e: CloseEvent) => any) | null = null
  private _onerror: ((e: Event) => any) | null = null

  readonly CONNECTING = WebSocket.CONNECTING
  readonly OPEN = WebSocket.OPEN
  readonly CLOSING = WebSocket.CLOSING
  readonly CLOSED = WebSocket.CLOSED

  constructor(relayerWs: WebSocket, encryptionKey?: CryptoKey) {
    this.relayerWs = relayerWs
    this.encryptionKey = encryptionKey

    console.log('[TunneledWebSocket] ctor: attaching relayer listeners; encrypted:', !!encryptionKey)

    // Forward events from relayer WebSocket
    this.relayerWs.addEventListener('open', this.handleOpen)
    this.relayerWs.addEventListener('close', this.handleClose as any)
    this.relayerWs.addEventListener('error', this.handleError)
    this.relayerWs.addEventListener('message', this.handleMessage)
  }

  get readyState(): number {
    return this.relayerWs.readyState
  }

  // Optional passthroughs (harmless, and some libs read them)
  get bufferedAmount(): number {
    return this.relayerWs.bufferedAmount
  }

  get binaryType(): BinaryType {
    return this.relayerWs.binaryType
  }
  set binaryType(value: BinaryType) {
    this.relayerWs.binaryType = value
  }

  // WebSocket-style handler properties
  get onopen() {
    return this._onopen
  }
  set onopen(fn: ((e: Event) => any) | null) {
    console.log('[TunneledWebSocket] onopen set:', !!fn)
    this._onopen = fn
  }

  get onmessage() {
    return this._onmessage
  }
  set onmessage(fn: ((e: MessageEvent) => any) | null) {
    console.log('[TunneledWebSocket] onmessage set:', !!fn)
    this._onmessage = fn
  }

  get onclose() {
    return this._onclose
  }
  set onclose(fn: ((e: CloseEvent) => any) | null) {
    console.log('[TunneledWebSocket] onclose set:', !!fn)
    this._onclose = fn
  }

  get onerror() {
    return this._onerror
  }
  set onerror(fn: ((e: Event) => any) | null) {
    console.log('[TunneledWebSocket] onerror set:', !!fn)
    this._onerror = fn
  }

  /**
   * Mimic native WebSocket: send is synchronous outward.
   * Internally we serialize async work (Blob conversion/encryption).
   */
  send(data: string | ArrayBuffer | Blob): void {
    const start = performance.now()
    console.log(
      '[TunneledWebSocket] send: called; data type:',
      typeof data,
      'instance:',
      (data as any)?.constructor?.name
    )

    this.sendChain = this.sendChain
      .then(async () => {
        const queuedAt = performance.now()
        console.log('[TunneledWebSocket] send: dequeued after', Math.round(queuedAt - start), 'ms')
        await this._sendInternal(data)
      })
      .catch(err => {
        console.error('[TunneledWebSocket] send: chain error (continuing):', err)
      })
  }

  private async _sendInternal(data: string | ArrayBuffer | Blob): Promise<void> {
    if (this.readyState !== WebSocket.OPEN) {
      console.error('[TunneledWebSocket] send: WebSocket not open; readyState:', this.readyState)
      throw new Error('WebSocket is not open')
    }

    let payload: string

    if (data instanceof ArrayBuffer) {
      console.log('[TunneledWebSocket] send: Converting ArrayBuffer to string')
      payload = new TextDecoder().decode(data)
    } else if (data instanceof Blob) {
      console.log('[TunneledWebSocket] send: Converting Blob to string; size:', data.size)
      payload = await data.text()
    } else {
      payload = data
    }

    console.log('[TunneledWebSocket] send: Payload preview:', payload.substring(0, 100))

    if (this.encryptionKey) {
      console.log('[TunneledWebSocket] send: Encrypting payload')
      const t0 = performance.now()
      const encryptedBytes = await aes.encryptBytes(payload, this.encryptionKey)
      const t1 = performance.now()
      console.log(
        '[TunneledWebSocket] send: Encrypted bytes length:',
        encryptedBytes.length,
        'encrypt ms:',
        Math.round(t1 - t0)
      )

      console.log('[TunneledWebSocket] send: Sending binary to relayer')
      this.relayerWs.send(encryptedBytes.buffer)
    } else {
      console.log('[TunneledWebSocket] send: Sending plaintext to relayer')
      this.relayerWs.send(payload)
    }
  }

  close(code?: number, reason?: string): void {
    console.log('[TunneledWebSocket] close() called:', code, reason)
    this.relayerWs.close(code, reason)
  }

  addEventListener(type: string, listener: EventListener): void {
    console.log('[TunneledWebSocket] addEventListener:', type)
    switch (type) {
      case 'message':
        this.messageListeners.add(listener)
        console.log('[TunneledWebSocket] messageListeners size:', this.messageListeners.size)
        break
      case 'open':
        this.openListeners.add(listener)
        console.log('[TunneledWebSocket] openListeners size:', this.openListeners.size)
        break
      case 'close':
        this.closeListeners.add(listener)
        console.log('[TunneledWebSocket] closeListeners size:', this.closeListeners.size)
        break
      case 'error':
        this.errorListeners.add(listener)
        console.log('[TunneledWebSocket] errorListeners size:', this.errorListeners.size)
        break
      default:
        console.warn('[TunneledWebSocket] addEventListener: unknown type:', type)
        break
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    console.log('[TunneledWebSocket] removeEventListener:', type)
    switch (type) {
      case 'message':
        this.messageListeners.delete(listener)
        console.log('[TunneledWebSocket] messageListeners size:', this.messageListeners.size)
        break
      case 'open':
        this.openListeners.delete(listener)
        console.log('[TunneledWebSocket] openListeners size:', this.openListeners.size)
        break
      case 'close':
        this.closeListeners.delete(listener)
        console.log('[TunneledWebSocket] closeListeners size:', this.closeListeners.size)
        break
      case 'error':
        this.errorListeners.delete(listener)
        console.log('[TunneledWebSocket] errorListeners size:', this.errorListeners.size)
        break
      default:
        console.warn('[TunneledWebSocket] removeEventListener: unknown type:', type)
        break
    }
  }

  private handleOpen = (event: Event) => {
    console.log('[TunneledWebSocket] relayer open')

    try {
      this._onopen?.(event)
    } catch (e) {
      console.error('[TunneledWebSocket] onopen handler threw:', e)
    }

    this.openListeners.forEach(listener => {
      try {
        listener(event)
      } catch (e) {
        console.error('[TunneledWebSocket] open listener threw:', e)
      }
    })
  }

  private handleClose = (event: CloseEvent) => {
    console.log(
      '[TunneledWebSocket] relayer close:',
      'code=',
      event.code,
      'reason=',
      event.reason,
      'wasClean=',
      event.wasClean
    )

    try {
      this._onclose?.(event)
    } catch (e) {
      console.error('[TunneledWebSocket] onclose handler threw:', e)
    }

    this.closeListeners.forEach(listener => {
      try {
        listener(event)
      } catch (e) {
        console.error('[TunneledWebSocket] close listener threw:', e)
      }
    })

    this.cleanup()
  }

  private handleError = (event: Event) => {
    console.error('[TunneledWebSocket] relayer error:', event)

    try {
      this._onerror?.(event)
    } catch (e) {
      console.error('[TunneledWebSocket] onerror handler threw:', e)
    }

    this.errorListeners.forEach(listener => {
      try {
        listener(event)
      } catch (e) {
        console.error('[TunneledWebSocket] error listener threw:', e)
      }
    })
  }

  private static bytesToBase64(bytes: Uint8Array): string {
    // Safe chunked conversion to avoid stack overflow and performance cliffs.
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  /**
   * IMPORTANT: This handler is NOT async anymore; it serializes async work via recvChain.
   * This preserves message ordering for SDKs that attach one-shot listeners per call.
   */
  private handleMessage = (event: MessageEvent) => {
    this.recvChain = this.recvChain
      .then(() => this._handleMessageInternal(event))
      .catch(err => {
        console.error('[TunneledWebSocket] recvChain error:', err)
      })
  }

  private async _handleMessageInternal(event: MessageEvent) {
    try {
      let data = event.data
      console.log(
        '[TunneledWebSocket] Received message, type:',
        typeof data,
        'instance:',
        data?.constructor?.name,
        'encrypted:',
        !!this.encryptionKey
      )

      // Decrypt if key is present
      if (this.encryptionKey) {
        if (typeof data === 'string') {
          console.log('[TunneledWebSocket] Decrypting text message, length:', data.length)
          data = await aes.decrypt(data, this.encryptionKey)
          console.log('[TunneledWebSocket] Text message decrypted successfully')
        } else if (data instanceof ArrayBuffer) {
          console.log(
            '[TunneledWebSocket] Decrypting binary ArrayBuffer message, length:',
            data.byteLength
          )
          const base64 = TunneledWebSocket.bytesToBase64(new Uint8Array(data))
          console.log('[TunneledWebSocket] Converted to base64, length:', base64.length)
          data = await aes.decrypt(base64, this.encryptionKey)
          console.log('[TunneledWebSocket] Binary message decrypted successfully')
        } else if (data instanceof Blob) {
          console.log('[TunneledWebSocket] Decrypting Blob message, size:', data.size)
          const arrayBuffer = await data.arrayBuffer()
          const base64 = TunneledWebSocket.bytesToBase64(new Uint8Array(arrayBuffer))
          console.log('[TunneledWebSocket] Converted blob to base64, length:', base64.length)
          data = await aes.decrypt(base64, this.encryptionKey)
          console.log('[TunneledWebSocket] Blob message decrypted successfully')
          console.log(
            '[TunneledWebSocket] Decrypted data type:',
            typeof data,
            'preview:',
            (data as any)?.substring?.(0, 100)
          )
        } else {
          console.warn('[TunneledWebSocket] Unknown message type:', data)
        }
      }

      console.log('[TunneledWebSocket] Final data type before forwarding:', typeof data)

      const newEvent = new MessageEvent('message', {
        data,
        origin: event.origin,
        lastEventId: event.lastEventId,
        source: event.source,
        ports: event.ports as any,
      })

      console.log(
        '[TunneledWebSocket] Forwarding message to handlers; listeners=',
        this.messageListeners.size
      )
      console.log(
        '[TunneledWebSocket] newEvent.data type:',
        typeof newEvent.data,
        'preview:',
        typeof newEvent.data === 'string' ? newEvent.data.substring(0, 100) : newEvent.data
      )

      // Call property handler first
      try {
        this._onmessage?.(newEvent)
      } catch (e) {
        console.error('[TunneledWebSocket] onmessage handler threw:', e)
      }

      // Call addEventListener listeners
      this.messageListeners.forEach(listener => {
        try {
          listener(newEvent)
        } catch (e) {
          console.error('[TunneledWebSocket] message listener threw:', e)
        }
      })
    } catch (error) {
      console.error('[TunneledWebSocket] Failed to decrypt/forward message:', error)
      console.error('[TunneledWebSocket] Message data type:', typeof event.data)
      console.error('[TunneledWebSocket] Error stack:', error instanceof Error ? error.stack : 'N/A')

      const errorEvent = new ErrorEvent('error', {
        error,
        message: 'Decrypt/forward failed',
      })

      try {
        this._onerror?.(errorEvent)
      } catch (e) {
        console.error('[TunneledWebSocket] onerror handler threw during message failure:', e)
      }

      this.errorListeners.forEach(listener => {
        try {
          listener(errorEvent)
        } catch (e) {
          console.error('[TunneledWebSocket] error listener threw during message failure:', e)
        }
      })
    }
  }

  private cleanup(): void {
    console.log('[TunneledWebSocket] cleanup: removing relayer listeners + clearing local listeners')

    this.relayerWs.removeEventListener('open', this.handleOpen)
    this.relayerWs.removeEventListener('close', this.handleClose as any)
    this.relayerWs.removeEventListener('error', this.handleError)
    this.relayerWs.removeEventListener('message', this.handleMessage)

    this.messageListeners.clear()
    this.openListeners.clear()
    this.closeListeners.clear()
    this.errorListeners.clear()

    // Null out handler properties to avoid retaining closures
    this._onopen = null
    this._onmessage = null
    this._onclose = null
    this._onerror = null
  }
}
