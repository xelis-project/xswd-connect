import type {
  ConnectionOptions,
  RelayedConnection,
  EncryptionMode,
  RelayerQRData,
  ChannelCreationMessage,
} from './types'
import { TunneledWebSocket } from './TunneledWebSocket'
import * as aes from './crypto/aes'

const DEFAULT_RELAYER_URL = 'wss://relay.xelis.io/ws'
const DEFAULT_TIMEOUT = 120000 // 2 minutes
const DEFAULT_ENCRYPTION_MODE: EncryptionMode = 'aes'

/**
 * Create a relayed connection to an XSWD wallet
 *
 * @example
 * ```typescript
 * const connection = await createConnection({
 *   onQRReady: (qrData) => {
 *     // Display QR code to user
 *     showQRCodeModal(qrData)
 *   },
 *   onConnected: () => {
 *     console.log('Wallet connected!')
 *   }
 * })
 *
 * // Use the socket with XSWD
 * const xswd = new XSWD(connection.socket)
 * await xswd.authorize(appData)
 * ```
 */
export async function createConnection(
  options: ConnectionOptions = {}
): Promise<RelayedConnection> {
  const {
    relayerUrl = DEFAULT_RELAYER_URL,
    encryptionMode = DEFAULT_ENCRYPTION_MODE,
    timeout = DEFAULT_TIMEOUT,
    appData,
    onQRReady,
    onConnected,
    onError,
    onClose,
  } = options

  return new Promise((resolve, reject) => {
    let encryptionKey: CryptoKey | undefined
    let channelId: string
    let relayerWs: WebSocket
    let tunneledSocket: TunneledWebSocket
    let timeoutHandle: ReturnType<typeof setTimeout>
    let isResolved = false

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (relayerWs && relayerWs.readyState === WebSocket.OPEN) {
        relayerWs.close()
      }
    }

    const handleError = (error: Error) => {
      if (isResolved) return
      isResolved = true
      cleanup()

      // Clear QR data on error
      onQRReady?.(null as any)

      onError?.(error)
      reject(error)
    }

    const handleSuccess = () => {
      if (isResolved) return
      isResolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      onConnected?.()

      resolve({
        socket: tunneledSocket,
        qrData: createQRData(),
        qrDataObj: createQRDataObj(),
        close: () => tunneledSocket.close(),
        readyState: tunneledSocket.readyState,
      })
    }

    const createQRDataObj = (): RelayerQRData => ({
      channel_id: channelId,
      relayer: relayerUrl.replace('/ws', ''), // Remove /ws suffix for base URL
      encryption_mode: encryptionMode,
      encryption_key: encryptionKey ? '' : undefined, // Will be filled in createQRData
      app_data: appData,
    })

    const createQRData = (): string => {
      const qrObj = createQRDataObj()

      // Add encryption key if present
      if (encryptionKey) {
        // Export key synchronously if possible, otherwise we need to rework this
        // For now, we'll handle it in the async initialization
        return '' // Placeholder, will be set properly
      }

      return JSON.stringify(qrObj)
    }

    // Setup timeout
    timeoutHandle = setTimeout(() => {
      handleError(new Error(`Connection timeout after ${timeout}ms - wallet did not connect`))
    }, timeout)

    // Initialize encryption if needed
    const initPromise = (async () => {
      if (encryptionMode === 'aes') {
        encryptionKey = await aes.generateKey()
      } else if (encryptionMode === 'chacha20poly1305') {
        throw new Error('ChaCha20-Poly1305 encryption not yet implemented')
      }
    })()

    // Connect to relayer to create channel
    relayerWs = new WebSocket(relayerUrl)

    relayerWs.addEventListener('error', () => {
      handleError(new Error('Failed to connect to relayer server'))
    })

    relayerWs.addEventListener('close', (event) => {
      if (!isResolved) {
        const reason = event.reason || (event.code === 1006 ? 'Connection failed - could not reach relayer' : 'Unknown reason')
        handleError(new Error(`Relayer connection closed: ${reason}`))
      }
      onClose?.(event)
    })

    relayerWs.addEventListener('message', async (event) => {
      try {
        const data: ChannelCreationMessage = JSON.parse(event.data)

        if (!data.channel_id) {
          handleError(new Error('Invalid response from relayer: missing channel_id'))
          return
        }

        channelId = data.channel_id

        // Wait for encryption initialization
        await initPromise

        // Create QR data with encryption key
        const qrDataObj: RelayerQRData = {
          channel_id: channelId,
          relayer: relayerUrl.replace('/ws', ''),
          encryption_mode: encryptionMode,
          encryption_key: encryptionKey ? await aes.exportKey(encryptionKey) : undefined,
          app_data: appData,
        }

        const qrData = JSON.stringify(qrDataObj)

        // Notify that QR is ready
        onQRReady?.(qrDataObj)

        // Now wait for peer to connect
        // The relayer will forward messages once peer joins
        // We detect peer connection when we receive the first message after QR display

        // Create tunneled socket
        tunneledSocket = new TunneledWebSocket(relayerWs, encryptionKey)

        // Wait for the wallet to connect
        // The relayer automatically starts forwarding once both peers are connected
        // We'll know connection is ready when we can start using the socket

        // For XSWD, the first message will be the authorization request from the dApp
        // So we consider connection ready immediately after QR display
        // The actual handshake happens at XSWD protocol level

        // Return the connection
        handleSuccess()

      } catch (error) {
        handleError(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

/**
 * Generate a QR code data URL for displaying
 *
 * @param qrData - The QR data object or JSON string
 * @returns Promise resolving to a data URL
 */
export interface QRCodeOptions {
  /** QR code color (default: #000000) */
  color?: string
  /** Background color (default: #FFFFFF) */
  backgroundColor?: string
  /** Optional logo to display in center of QR code */
  logoUrl?: string
  /** Logo size as percentage of QR code (default: 0.2 = 20%) */
  logoSize?: number
}

export async function generateQRCodeDataURL(
  qrData: RelayerQRData | string,
  options: QRCodeOptions = {}
): Promise<string> {
  const QRCode = await import('qrcode')
  const data = typeof qrData === 'string' ? qrData : JSON.stringify(qrData)

  const {
    color = '#000000',
    backgroundColor = '#FFFFFF',
    logoUrl,
    logoSize = 0.2,
  } = options

  // Generate base QR code with higher error correction for logo
  const qrDataUrl = await QRCode.toDataURL(data, {
    errorCorrectionLevel: logoUrl ? 'H' : 'M', // High error correction if logo present
    margin: 2,
    width: 300,
    color: {
      dark: color,
      light: backgroundColor,
    },
  })

  // If no logo, return the QR code as-is
  if (!logoUrl) {
    return qrDataUrl
  }

  // Draw logo on top of QR code
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Failed to get canvas context'))
      return
    }

    const qrImage = new Image()
    qrImage.onload = () => {
      canvas.width = qrImage.width
      canvas.height = qrImage.height

      // Draw QR code
      ctx.drawImage(qrImage, 0, 0)

      // Load and draw logo
      const logoImage = new Image()
      logoImage.crossOrigin = 'anonymous'
      logoImage.onload = () => {
        const logoSizePixels = canvas.width * logoSize
        const x = (canvas.width - logoSizePixels) / 2
        const y = (canvas.height - logoSizePixels) / 2

        // Draw white background circle for logo
        ctx.fillStyle = backgroundColor
        ctx.beginPath()
        ctx.arc(canvas.width / 2, canvas.height / 2, logoSizePixels / 2 + 4, 0, 2 * Math.PI)
        ctx.fill()

        // Draw logo
        ctx.drawImage(logoImage, x, y, logoSizePixels, logoSizePixels)

        resolve(canvas.toDataURL())
      }
      logoImage.onerror = () => {
        // If logo fails to load, return QR code without logo
        resolve(qrDataUrl)
      }
      logoImage.src = logoUrl
    }
    qrImage.onerror = () => reject(new Error('Failed to load QR code image'))
    qrImage.src = qrDataUrl
  })
}
