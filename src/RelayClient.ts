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
    super()

    // @ts-ignore
    this.socket = socket as any
    this.endpoint = ''

    ;(this as any).callTimeout = 0
    ;(this as any).timeout = 0

    this.reconnectOnConnectionLoss = false
    this.maxConnectionTries = 1

    this.daemon = new DaemonMethods(this, 'node.')
    this.wallet = new WalletMethods(this, 'wallet.')
  }

  rawCall<T>(id: number, body: string): Promise<T> {
    ;(this as any).callTimeout = 0
    ;(this as any).timeout = 0
    return super.rawCall(id, body)
  }

  authorize(app: ApplicationData): Promise<any> {
    const data = JSON.stringify(app)
    return this.rawCall(0, data)
  }
}
