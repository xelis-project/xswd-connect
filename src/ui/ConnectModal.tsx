import { useState, useEffect } from 'react'
import { createConnection, generateQRCodeDataURL } from '../RelayerClient'
import type { RelayerQRData, ConnectionOptions } from '../types'

// Isolated countdown timer component to avoid re-render issues
const CountdownTimer = ({
  initialSeconds,
  onExpire,
  secondaryTextColor
}: {
  initialSeconds: number
  onExpire: () => void
  secondaryTextColor: string
}) => {
  const [countdown, setCountdown] = useState(initialSeconds)

  useEffect(() => {
    setCountdown(initialSeconds)
  }, [initialSeconds])

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          onExpire()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [onExpire])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div style={{ fontSize: '22px', color: secondaryTextColor, marginBottom: '10px', fontWeight: 400 }}>
      Expires in {formatTime(countdown)}
    </div>
  )
}

export interface ConnectModalTheme {
  /** Primary accent color (default: #3396FF) */
  primaryColor?: string
  /** Background color (default: #FFFFFF) */
  backgroundColor?: string
  /** Text color (default: #141414) */
  textColor?: string
  /** Secondary text color (default: #798686) */
  secondaryTextColor?: string
  /** Outline/border color for cards (default: primaryColor with 40% opacity) */
  outlineColor?: string
  /** Border radius (default: 24px) */
  borderRadius?: string
  /** Font family (default: system-ui) */
  fontFamily?: string
  /** QR code foreground/dots color (default: #000000) */
  qrForegroundColor?: string
  /** QR code background color (default: #FFFFFF) */
  qrBackgroundColor?: string
  /** QR code center logo background color (optional, creates rounded rect behind logo) */
  qrCenterBackgroundColor?: string
}

export interface ConnectModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Close handler */
  onClose: () => void
  /** Called when direct connection is selected - app should create XSWD(LOCAL_WS) */
  onDirectConnect: () => Promise<void>
  /** Called when relayed connection succeeds with the WebSocket-like object */
  onRelayedConnect: (socket: any) => Promise<void>
  /** Optional relayer URL override */
  relayerUrl?: string
  /** XSWD app metadata (required for relay connections) */
  appData: ConnectionOptions['appData']
  /** Optional theme customization */
  theme?: ConnectModalTheme
  /** App name to display */
  appName?: string
  /** App icon URL */
  appIcon?: string
}

type ConnectionState = 'select' | 'qr' | 'connecting' | 'error'

// Detect Brave browser
const isBrave = () => {
  return (navigator as any).brave && typeof (navigator as any).brave.isBrave === 'function'
}

export const ConnectModal = ({
  isOpen,
  onClose,
  onDirectConnect,
  onRelayedConnect,
  relayerUrl,
  appData,
  theme = {},
  appName = 'dApp',
  appIcon,
}: ConnectModalProps) => {
  const [state, setState] = useState<ConnectionState>('select')
  const [qrCodeUrl, setQrCodeUrl] = useState<string>()
  const [qrData, setQrData] = useState<RelayerQRData>()
  const [timeoutSeconds, setTimeoutSeconds] = useState(120)
  const [error, setError] = useState<string>()
  const [pendingConnection, setPendingConnection] = useState<{ close: () => void; timeoutSeconds?: number } | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [showBraveAlert, setShowBraveAlert] = useState(false)

  // Check if Brave browser on mount
  useEffect(() => {
    setShowBraveAlert(isBrave())
  }, [])

  // Apply theme defaults (WalletConnect-inspired)
  const t = {
    primaryColor: theme.primaryColor || '#3396FF',
    backgroundColor: theme.backgroundColor || '#FFFFFF',
    textColor: theme.textColor || '#141414',
    secondaryTextColor: theme.secondaryTextColor || '#798686',
    outlineColor: theme.outlineColor || `${theme.primaryColor || '#3396FF'}40`, // 40 = 25% opacity in hex
    borderRadius: theme.borderRadius || '24px',
    fontFamily: theme.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    qrForegroundColor: theme.qrForegroundColor || '#000000',
    qrBackgroundColor: theme.qrBackgroundColor || '#FFFFFF',
    qrCenterBackgroundColor: theme.qrCenterBackgroundColor,
  }

  // Detect if dark mode based on background color brightness
  const isDark = theme.backgroundColor &&
    parseInt(theme.backgroundColor.slice(1, 3), 16) < 128

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setState('select')
      setError(undefined)
      setQrCodeUrl(undefined)
      setQrData(undefined)
      setTimeoutSeconds(120)
      setCopySuccess(false)
    } else {
      // Clean up any pending connection when modal closes
      if (pendingConnection) {
        pendingConnection.close()
        setPendingConnection(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleDirectConnect = async () => {
    setState('connecting')
    setError(undefined)

    try {
      await onDirectConnect()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setState('error')
    }
  }

  const handleRelayedConnect = async () => {
    setState('qr')
    setError(undefined)

    try {
      const connection = await createConnection({
        relayerUrl,
        appData,
        onQRReady: async (data) => {
          if (!data) {
            // Error occurred, data is null
            return
          }
          setQrData(data)
          const url = await generateQRCodeDataURL(data, {
            color: t.qrForegroundColor,
            backgroundColor: t.qrBackgroundColor,
            centerBackgroundColor: t.qrCenterBackgroundColor,
            logoUrl: appIcon,
            logoSize: 0.22,
          })
          setQrCodeUrl(url)
        },
        onConnected: () => {
          setState('connecting')
        },
        onError: (err) => {
          setError(err.message)
          setState('error')
        },
      })

      // Store connection reference for cleanup
      setPendingConnection(connection)

      // Set timeout from relayer (fallback to 120 if not provided)
      if (connection.timeoutSeconds) {
        console.log('[ConnectModal] Using relayer timeout:', connection.timeoutSeconds, 'seconds')
        setTimeoutSeconds(connection.timeoutSeconds)
      } else {
        console.log('[ConnectModal] No relayer timeout, using default 120 seconds')
      }

      await onRelayedConnect(connection)
      setPendingConnection(null) // Clear reference after successful connection
      onClose()
    } catch (err) {
      setPendingConnection(null)
      setError(err instanceof Error ? err.message : 'Failed to connect to relay')
      setState('error')
    }
  }

  const handleBackToSelect = () => {
    // Clean up any pending connection to cancel timeout
    if (pendingConnection) {
      pendingConnection.close()
      setPendingConnection(null)
    }

    setState('select')
    setError(undefined)
    setQrCodeUrl(undefined)
    setQrData(undefined)
    setTimeoutSeconds(120)
    setCopySuccess(false)
  }

  const handleExpire = () => {
    setError('QR code expired - please try again')
    setState('error')
  }

  const handleCopyQRData = async () => {
    if (!qrData) return

    try {
      await navigator.clipboard.writeText(JSON.stringify(qrData))
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy QR data:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        fontFamily: t.fontFamily,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: t.backgroundColor,
          borderRadius: t.borderRadius,
          padding: '28px 32px 32px',
          maxWidth: '400px',
          width: '100%',
          position: 'relative',
          boxShadow: isDark
            ? '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08)'
            : '0 2px 16px rgba(0, 0, 0, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
            border: 'none',
            color: t.secondaryTextColor,
            cursor: 'pointer',
            fontSize: '20px',
            lineHeight: 1,
            padding: '6px',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s',
          }}
          onMouseOver={(e) => e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)'}
          onMouseOut={(e) => e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}
          aria-label="Close"
        >
          ×
        </button>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '22px',
              fontWeight: 600,
              color: t.textColor,
              letterSpacing: '-0.02em',
            }}
          >
            Connect Wallet
          </h2>
        </div>

        {/* Brave Browser Alert */}
        {state === 'select' && showBraveAlert && (
          <div
            style={{
              marginBottom: '16px',
              padding: '14px 16px',
              borderRadius: '12px',
              background: isDark ? 'rgba(255, 159, 10, 0.12)' : 'rgba(255, 159, 10, 0.1)',
              border: `1px solid ${isDark ? 'rgba(255, 159, 10, 0.3)' : 'rgba(255, 159, 10, 0.25)'}`,
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                marginTop: '2px',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#FFB340' : '#FF9F0A'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: isDark ? '#FFB340' : '#FF9F0A',
                  marginBottom: '4px',
                  lineHeight: '18px',
                }}
              >
                Brave Browser Detected
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: isDark ? 'rgba(255, 255, 255, 0.75)' : 'rgba(0, 0, 0, 0.7)',
                  lineHeight: '18px',
                }}
              >
                To connect to a local wallet, enable "Enable Localhost access permission prompt" in{' '}
                <code style={{
                  fontSize: '12px',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
                  fontFamily: 'monospace',
                }}>
                  brave://flags/#brave-localhost-access-permission
                </code>
              </div>
            </div>
            <button
              onClick={() => setShowBraveAlert(false)}
              style={{
                flexShrink: 0,
                background: 'transparent',
                border: 'none',
                color: isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.4)',
                cursor: 'pointer',
                fontSize: '16px',
                lineHeight: 1,
                padding: '0',
                width: '16px',
                height: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.2s',
                marginTop: '1px',
              }}
              onMouseOver={(e) => e.currentTarget.style.color = isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.7)'}
              onMouseOut={(e) => e.currentTarget.style.color = isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.4)'}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Connection method selection */}
        {state === 'select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={handleDirectConnect}
              style={{
                width: '100%',
                padding: '16px 18px',
                border: `1px solid ${t.outlineColor}`,
                borderRadius: '16px',
                background: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)',
                color: t.textColor,
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'
                e.currentTarget.style.borderColor = `${t.primaryColor}80`
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)'
                e.currentTarget.style.borderColor = t.outlineColor
              }}
            >
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ lineHeight: '20px' }}>Local Wallet</div>
                <div style={{ fontSize: '13px', color: t.secondaryTextColor, marginTop: '2px', lineHeight: '16px' }}>
                  Connect via WebSocket server
                </div>
              </div>
            </button>

            <button
              onClick={handleRelayedConnect}
              style={{
                width: '100%',
                padding: '16px 18px',
                border: `1px solid ${t.outlineColor}`,
                borderRadius: '16px',
                background: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)',
                color: t.textColor,
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'
                e.currentTarget.style.borderColor = `${t.primaryColor}80`
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)'
                e.currentTarget.style.borderColor = t.outlineColor
              }}
            >
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <path d="M12 18h.01" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ lineHeight: '20px' }}>Mobile/Relayed Wallet</div>
                <div style={{ fontSize: '13px', color: t.secondaryTextColor, marginTop: '2px', lineHeight: '16px' }}>
                  Scan QR code with your phone
                </div>
              </div>
            </button>
          </div>
        )}

        {/* QR Code display */}
        {state === 'qr' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 0 20px', fontSize: '14px', color: t.secondaryTextColor, lineHeight: '20px' }}>
              Scan this QR code with your XELIS mobile wallet
            </p>

            <div
              style={{
                backgroundColor: isDark ? '#FFFFFF' : '#F7F8F9',
                padding: '8px',
                borderRadius: '16px',
                display: 'inline-block',
                marginBottom: '5px',
                border: isDark ? 'none' : '1px solid rgba(0, 0, 0, 0.06)',
              }}
            >
              {qrCodeUrl ? (
                <img src={qrCodeUrl} alt="QR Code" style={{ width: '284px', height: '284px', display: 'block', borderRadius: '12px' }} />
              ) : (
                <div
                  style={{
                    width: '284px',
                    height: '284px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      border: `3px solid ${t.primaryColor}`,
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                </div>
              )}
            </div>

            {/* TODO: Cleanup TSX */}
            <button
              onClick={handleCopyQRData}
              disabled={!qrData}
              style={{
                background: !qrData
                  ? (isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)')
                  : copySuccess
                    ? (isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)')
                    : (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'),
                border: !qrData
                  ? (isDark ? '1px solid rgba(255, 255, 255, 0.04)' : '1px solid rgba(0, 0, 0, 0.04)')
                  : copySuccess
                    ? '1px solid rgba(34, 197, 94, 0.3)'
                    : (isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)'),
                borderRadius: '12px',
                color: !qrData
                  ? (isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)')
                  : copySuccess
                    ? '#22c55e'
                    : t.textColor,
                padding: '10px 20px',
                cursor: !qrData ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
                margin: 'auto',
                marginTop: '0px',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                maxWidth: '284px',
                opacity: !qrData ? 0.5 : 1,
              }}
              onMouseOver={(e) => {
                if (!copySuccess && qrData) {
                  e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)'
                }
              }}
              onMouseOut={(e) => {
                if (!copySuccess && qrData) {
                  e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'
                }
              }}
            >
              {copySuccess ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Connection Data
                </>
              )}
            </button>

            <CountdownTimer
              initialSeconds={timeoutSeconds}
              onExpire={handleExpire}
              secondaryTextColor={t.secondaryTextColor}
            />

            <button
              onClick={handleBackToSelect}
              style={{
                background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '12px',
                color: t.textColor,
                padding: '10px 20px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
              onMouseOver={(e) => e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)'}
              onMouseOut={(e) => e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'}
            >
              Back
            </button>
          </div>
        )}

        {/* Connecting state */}
        {state === 'connecting' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                border: `3px solid ${t.primaryColor}`,
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 20px',
              }}
            />
            <p style={{ fontSize: '15px', color: t.textColor, margin: 0, fontWeight: 500 }}>Connecting...</p>
          </div>
        )}

        {/* Error state */}
        {state === 'error' && error && (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#FEE2E2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                fontSize: '28px',
                color: '#DC2626',
              }}
            >
              !
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: t.textColor, fontWeight: 600 }}>Connection Failed</h3>
            <p style={{ fontSize: '14px', color: t.secondaryTextColor, margin: '0 0 24px', lineHeight: '20px' }}>{error}</p>
            <button
              onClick={handleBackToSelect}
              style={{
                background: t.primaryColor,
                border: 'none',
                borderRadius: '12px',
                color: '#FFFFFF',
                padding: '12px 24px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: 600,
                transition: 'opacity 0.15s ease',
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Try Again
            </button>
          </div>
        )}

        {/* App branding footer */}
        {(appIcon || appName) && (
          <div style={{
            marginTop: '28px',
            paddingTop: '20px',
            borderTop: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}>
            {appIcon && (
              <img
                src={appIcon}
                alt={appName}
                style={{
                  height: '32px',
                  maxWidth: '120px',
                  objectFit: 'contain',
                }}
              />
            )}
            {appName && (
              <span style={{
                fontSize: '15px',
                color: t.secondaryTextColor,
                fontWeight: 500,
              }}>
                {appName}
              </span>
            )}
          </div>
        )}

        {/* CSS for spinner animation */}
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}

export default ConnectModal
