import type {
  ConnectionOptions,
  RelayedConnection,
  EncryptionMode,
  RelayerQRData,
  ChannelCreationMessage,
} from './types'
import { TunneledWebSocket } from './TunneledWebSocket'
import { RelayClient } from './RelayClient'
import * as aes from './crypto/aes'
import QRCodeStyling from 'qr-code-styling'

const DEFAULT_RELAYER_URL = 'wss://relay.xelis.io/ws'
const DEFAULT_TIMEOUT = 120000 // 2 minutes
const DEFAULT_ENCRYPTION_MODE: EncryptionMode = 'aes'

// ---- helpers ----

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

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
  options: ConnectionOptions
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

  // Validate required appData
  if (!appData) {
    throw new Error('appData is required for XSWD relay connections')
  }

  return new Promise((resolve, reject) => {
    let encryptionKey: CryptoKey | undefined
    let exportedKey: string | undefined
    let channelId: string
    let relayerWs: WebSocket
    let tunneledSocket: TunneledWebSocket
    let timeoutHandle: ReturnType<typeof setTimeout>
    let isResolved = false
    let relayerTimeoutSeconds: number | undefined

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
      onQRReady?.(null)

      onError?.(error)
      reject(error)
    }

    const handleSuccess = () => {
      if (isResolved) return
      isResolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      onConnected?.()

      // Create RelayClient wrapping the TunneledWebSocket
      const client = new RelayClient(tunneledSocket)

      const result: RelayedConnection = {
        socket: tunneledSocket,
        client,
        qrData: createQRData(),
        qrDataObj: createQRDataObj(),
        close: () => tunneledSocket.close(),
        readyState: 0, // placeholder, overridden below
        timeoutSeconds: relayerTimeoutSeconds,
      }

      Object.defineProperty(result, 'readyState', {
        get: () => tunneledSocket.readyState,
        enumerable: true,
      })

      resolve(result)
    }

    const createQRDataObj = (): RelayerQRData => ({
      channel_id: channelId,
      endpoint: relayerUrl.replace(/\/ws$/, ''), // Remove /ws suffix for base URL
      relayer: `${relayerUrl}/${channelId}`,
      encryption_mode: {
        mode: encryptionMode,
        key: exportedKey ?? '',
      },
      app_data: appData,
    })

    const createQRData = (): string => JSON.stringify(createQRDataObj())

    // Setup timeout
    timeoutHandle = setTimeout(() => {
      handleError(new Error(`Connection timeout after ${timeout}ms - wallet did not connect`))
    }, timeout)

    // Initialize encryption if needed
    const initPromise = (async () => {
      if (encryptionMode === 'aes') {
        encryptionKey = await aes.generateKey()
        exportedKey = await aes.exportKey(encryptionKey)
      } else if (encryptionMode === 'chacha20poly1305') {
        throw new Error('ChaCha20-Poly1305 not yet implemented')
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
        cleanup();
        handleError(new Error(`Relayer connection closed: ${reason}`))
      }
      onClose?.(event)
    })

    relayerWs.addEventListener('message', async (event) => {
      try {
        // Only handle text messages (control messages from relayer)
        // Binary messages are encrypted data from the wallet, handled by TunneledWebSocket
        if (typeof event.data !== 'string') {
          return
        }

        const data = JSON.parse(event.data)

        // Ignore peer_connected notification - it's handled by the tunneled socket
        if (data.type === 'peer_connected') {
          return
        }

        // This should be the channel creation message
        if (!data.channel_id) {
          handleError(new Error('Invalid response from relayer: missing channel_id'))
          return
        }

        channelId = data.channel_id
        // Capture timeout from relayer (in seconds) - this will be displayed in the modal
        relayerTimeoutSeconds = data.timeout
        console.log('[RelayerClient] Relayer timeout:', relayerTimeoutSeconds, 'seconds')

        // Wait for encryption initialization
        await initPromise

        // Create QR data with encryption key AND app data
        onQRReady?.(createQRDataObj())

        // Now wait for peer to connect
        // The relayer will forward messages once peer joins
        // The wallet will have the app data from the QR code

        // Create tunneled socket
        tunneledSocket = new TunneledWebSocket(relayerWs, encryptionKey)

        // Wait for any message from the wallet (indicates peer connected and relay is ready)
        const handleFirstMessage = (event: Event) => {
          // Remove the listener - we only care about the first message
          tunneledSocket.removeEventListener('message', handleFirstMessage)
          tunneledSocket.removeEventListener('error', handleEarlyError)
          tunneledSocket.removeEventListener('close', handleEarlyClose)
          // Peer is connected, resolve the connection
          handleSuccess()
        }

        tunneledSocket.addEventListener('message', handleFirstMessage)

        // Also listen for errors/close before peer connects
        const handleEarlyError = (event: Event) => {
          tunneledSocket.removeEventListener('message', handleFirstMessage)
          tunneledSocket.removeEventListener('error', handleEarlyError)
          tunneledSocket.removeEventListener('close', handleEarlyClose)
          handleError(new Error('Connection lost before wallet connected'))
          cleanup();
        }

        const handleEarlyClose = (event: Event) => {
          tunneledSocket.removeEventListener('message', handleFirstMessage)
          tunneledSocket.removeEventListener('error', handleEarlyError)
          tunneledSocket.removeEventListener('close', handleEarlyClose)
          if (!isResolved) {
            handleError(new Error('Connection closed before wallet connected'))
          }
          cleanup();
        }

        tunneledSocket.addEventListener('error', handleEarlyError)
        tunneledSocket.addEventListener('close', handleEarlyClose)

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
  /** Optional background color for center logo area */
  centerBackgroundColor?: string
  /** Optional logo to display in center of QR code */
  logoUrl?: string
  /** Logo size as percentage of QR code (default: 0.2 = 20%) */
  logoSize?: number
}

export async function generateQRCodeDataURL(
  qrData: RelayerQRData | string,
  options: QRCodeOptions = {}
): Promise<string> {
  const data = typeof qrData === 'string' ? qrData : JSON.stringify(qrData)

  const {
    color = '#000000',
    backgroundColor = '#FFFFFF',
    centerBackgroundColor,
    logoUrl,
    logoSize = 0.22,
  } = options

  const qrCode = new QRCodeStyling({
    width: 900,
    height: 900,
    data,
    margin: 0,
    qrOptions: {
      errorCorrectionLevel: logoUrl ? 'H' : 'M',
    },
    imageOptions: {
      crossOrigin: 'anonymous',
      margin: 8,
      imageSize: logoUrl ? logoSize : 0,
      hideBackgroundDots: !!logoUrl,
    },
    dotsOptions: {
      color,
      type: 'rounded',
    },
    backgroundOptions: {
      color: backgroundColor,
    },
    cornersSquareOptions: {
      color,
      type: 'extra-rounded',
    },
    cornersDotOptions: {
      color,
      type: 'dot',
    },
    image: logoUrl,
  })

  const rawData = await qrCode.getRawData('png')
  if (!rawData) {
    throw new Error('Failed to generate QR code')
  }

  const blob = rawData instanceof Blob ? rawData : new Blob([rawData as any])

  // No center background needed — return QR directly
  if (!centerBackgroundColor || !logoUrl) {
    return blobToDataURL(blob)
  }

  // Draw QR with a rounded-rect background behind the logo
  const qrDataURL = await blobToDataURL(blob)
  const qrImg = await loadImage(qrDataURL)

  const canvas = document.createElement('canvas')
  canvas.width = qrImg.width
  canvas.height = qrImg.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  // Draw QR base
  ctx.drawImage(qrImg, 0, 0)

  // Draw rounded rectangle behind logo
  const centerSize = canvas.width * (logoSize + 0.05)
  const x = (canvas.width - centerSize) / 2
  const y = (canvas.height - centerSize) / 2
  const r = centerSize * 0.15

  ctx.fillStyle = centerBackgroundColor
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + centerSize - r, y)
  ctx.quadraticCurveTo(x + centerSize, y, x + centerSize, y + r)
  ctx.lineTo(x + centerSize, y + centerSize - r)
  ctx.quadraticCurveTo(x + centerSize, y + centerSize, x + centerSize - r, y + centerSize)
  ctx.lineTo(x + r, y + centerSize)
  ctx.quadraticCurveTo(x, y + centerSize, x, y + centerSize - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()

  // Overlay logo
  try {
    const logoImg = await loadImage(logoUrl)
    const logoDisplaySize = canvas.width * logoSize
    const logoX = (canvas.width - logoDisplaySize) / 2
    const logoY = (canvas.height - logoDisplaySize) / 2

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(logoImg, logoX, logoY, logoDisplaySize, logoDisplaySize)
  } catch {
    // Logo failed to load — return QR with background rect only
  }

  return canvas.toDataURL()
}