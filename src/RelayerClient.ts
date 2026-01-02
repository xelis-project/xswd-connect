import type {
  ConnectionOptions,
  RelayedConnection,
  EncryptionMode,
  RelayerQRData,
  ChannelCreationMessage,
} from './types'
import { TunneledWebSocket } from './TunneledWebSocket'
import * as aes from './crypto/aes'
import QRCodeStyling from 'qr-code-styling'

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

        // Wait for the wallet to actually connect by listening for the first message
        // This indicates the peer (wallet) has joined the channel
        const handleFirstMessage = () => {
          // Remove the listener - we only care about the first message
          tunneledSocket.removeEventListener('message', handleFirstMessage)
          // Now the wallet is connected, notify and resolve
          handleSuccess()
        }

        tunneledSocket.addEventListener('message', handleFirstMessage)

        // Also listen for errors/close before peer connects
        const handleEarlyError = (event: Event) => {
          tunneledSocket.removeEventListener('message', handleFirstMessage)
          tunneledSocket.removeEventListener('error', handleEarlyError)
          tunneledSocket.removeEventListener('close', handleEarlyClose)
          handleError(new Error('Connection lost before wallet connected'))
        }

        const handleEarlyClose = (event: Event) => {
          tunneledSocket.removeEventListener('message', handleFirstMessage)
          tunneledSocket.removeEventListener('error', handleEarlyError)
          tunneledSocket.removeEventListener('close', handleEarlyClose)
          if (!isResolved) {
            handleError(new Error('Connection closed before wallet connected'))
          }
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

  return new Promise((resolve, reject) => {
    try {
      // Render at 3x resolution for sharper quality
      const qrCode = new QRCodeStyling({
        width: 900,
        height: 900,
        data,
        margin: 0, // No margin - QR fills the entire canvas
        qrOptions: {
          errorCorrectionLevel: logoUrl ? 'H' : 'M',
        },
        imageOptions: logoUrl ? {
          crossOrigin: 'anonymous',
          margin: 8, // Gap around the logo
          imageSize: logoSize,
          hideBackgroundDots: true, // Hide dots behind the image
        } : undefined,
        dotsOptions: {
          color,
          type: 'rounded', // Rounded dots for prettier appearance
        },
        backgroundOptions: {
          color: backgroundColor,
        },
        cornersSquareOptions: {
          color,
          type: 'extra-rounded', // Rounded corner squares
        },
        cornersDotOptions: {
          color,
          type: 'dot', // Round dots in corners
        },
        image: logoUrl,
      })

      // Get the raw canvas to draw custom background
      const canvas = document.createElement('canvas')

      qrCode.getRawData('png').then((data) => {
        if (!data) {
          reject(new Error('Failed to generate QR code'))
          return
        }

        // Handle both Blob (browser) and Buffer (Node.js)
        let blob: Blob
        if (data instanceof Blob) {
          blob = data
        } else {
          // Convert Buffer to Blob for browser environment
          blob = new Blob([data as any])
        }

        // If we need to add a center background, draw it on the canvas
        if (centerBackgroundColor && logoUrl) {
          const reader = new FileReader()
          reader.onload = () => {
            const img = new Image()
            img.onload = () => {
              canvas.width = img.width
              canvas.height = img.height
              const ctx = canvas.getContext('2d')
              if (!ctx) {
                reject(new Error('Failed to get canvas context'))
                return
              }

              // Draw the QR code
              ctx.drawImage(img, 0, 0)

              // Calculate center area size (logo area + margin)
              const centerSize = canvas.width * (logoSize + 0.05) // Add extra 5% for padding
              const x = (canvas.width - centerSize) / 2
              const y = (canvas.height - centerSize) / 2
              const borderRadius = centerSize * 0.15 // 15% border radius

              // Draw rounded rectangle behind logo
              ctx.fillStyle = centerBackgroundColor
              ctx.beginPath()
              ctx.moveTo(x + borderRadius, y)
              ctx.lineTo(x + centerSize - borderRadius, y)
              ctx.quadraticCurveTo(x + centerSize, y, x + centerSize, y + borderRadius)
              ctx.lineTo(x + centerSize, y + centerSize - borderRadius)
              ctx.quadraticCurveTo(x + centerSize, y + centerSize, x + centerSize - borderRadius, y + centerSize)
              ctx.lineTo(x + borderRadius, y + centerSize)
              ctx.quadraticCurveTo(x, y + centerSize, x, y + centerSize - borderRadius)
              ctx.lineTo(x, y + borderRadius)
              ctx.quadraticCurveTo(x, y, x + borderRadius, y)
              ctx.closePath()
              ctx.fill()

              // Draw the logo on top (load it again to overlay)
              const logoImg = new Image()
              logoImg.crossOrigin = 'anonymous'
              logoImg.onload = () => {
                const logoDisplaySize = canvas.width * logoSize
                const logoX = (canvas.width - logoDisplaySize) / 2
                const logoY = (canvas.height - logoDisplaySize) / 2

                // Enable high-quality image smoothing for better downscaling
                ctx.imageSmoothingEnabled = true
                ctx.imageSmoothingQuality = 'high'

                ctx.drawImage(logoImg, logoX, logoY, logoDisplaySize, logoDisplaySize)
                resolve(canvas.toDataURL())
              }
              logoImg.onerror = () => {
                // If logo fails, just return QR with background
                resolve(canvas.toDataURL())
              }
              logoImg.src = logoUrl
            }
            img.onerror = () => reject(new Error('Failed to load QR image'))
            img.src = reader.result as string
          }
          reader.onerror = () => reject(new Error('Failed to read QR code blob'))
          reader.readAsDataURL(blob)
        } else {
          // No center background needed, just return the QR code
          const reader = new FileReader()
          reader.onload = () => {
            resolve(reader.result as string)
          }
          reader.onerror = () => reject(new Error('Failed to read QR code blob'))
          reader.readAsDataURL(blob)
        }
      }).catch(reject)
    } catch (error) {
      reject(error)
    }
  })
}
