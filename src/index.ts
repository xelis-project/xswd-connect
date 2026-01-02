/**
 * @xelis/xswd-connect
 *
 * JavaScript library for XSWD relayed connections - connect web dApps to mobile wallets
 * via QR code with end-to-end encryption
 *
 * @example
 * ```typescript
 * import { createConnection } from '@xelis/xswd-connect'
 * import XSWD from '@xelis/sdk/xswd/websocket'
 *
 * // Create relayed connection
 * const connection = await createConnection({
 *   onQRReady: (qrData) => {
 *     // Show QR code modal
 *     displayQRCode(qrData)
 *   },
 *   onConnected: () => {
 *     console.log('Wallet connected!')
 *   }
 * })
 *
 * // Use with XSWD client
 * const xswd = new XSWD(connection.socket)
 * await xswd.authorize({
 *   id: 'my-dapp',
 *   name: 'My dApp',
 *   permissions: ['wallet.get_balance', 'wallet.sign_transaction']
 * })
 * ```
 */

export { createConnection, generateQRCodeDataURL } from './RelayerClient'
export type { QRCodeOptions } from './RelayerClient'
export { TunneledWebSocket } from './TunneledWebSocket'
export { ConnectModal } from './ui/ConnectModal'
export type { ConnectModalProps, ConnectModalTheme } from './ui/ConnectModal'
export * from './types'
export * as crypto from './crypto/aes'
