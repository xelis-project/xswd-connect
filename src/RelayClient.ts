/**
 * XSWD client for relayed connections
 * Extends the SDK's WSRPC to wrap a TunneledWebSocket
 */

import { WSRPC } from '@xelis/sdk/rpc/websocket'
import { DaemonMethods } from '@xelis/sdk/daemon/websocket'
import { WalletMethods } from '@xelis/sdk/wallet/websocket'
import type { ApplicationData } from '@xelis/sdk/xswd/types'
import type { WebSocketLike } from './types'

export { ApplicationData }

/**
 * RelayClient extends WSRPC but uses an existing TunneledWebSocket
 * instead of creating a new WebSocket connection
 */
export class RelayClient extends WSRPC {
  daemon: DaemonMethods
  wallet: WalletMethods

  constructor(socket: WebSocketLike) {
    // Call parent constructor without connecting
    super()

    // Set the socket property directly (WSRPC stores it as 'socket')
    // @ts-ignore - accessing protected property
    this.socket = socket as any

    // Set endpoint to empty since we're not using connect()
    this.endpoint = ''

    // CRITICAL: Set timeout to 0 for XSWD (user needs time to review and approve transactions)
    // The default is 15000ms which is way too short for user interaction
    this.timeout = 0

    // Disable reconnection attempts since relay connections are managed differently
    this.reconnectOnConnectionLoss = false
    this.maxConnectionTries = 1

    this.daemon = new DaemonMethods(this, 'node.')
    this.wallet = new WalletMethods(this, 'wallet.')
  }

  /**
   * Override rawCall to ensure timeout is always disabled for XSWD operations
   */
  rawCall<T>(id: number, body: string): Promise<T> {
    // Force timeout to 0 before each call to ensure it's never set
    this.timeout = 0
    return super.rawCall(id, body)
  }

  /**
   * Authorize the application with the wallet
   */
  authorize(app: ApplicationData): Promise<any> {
    const data = JSON.stringify(app)
    return this.rawCall(0, data)
  }
}
