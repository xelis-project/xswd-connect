# xswd-connect

**Secure cross-device connections for XSWD protocol**

Connect web dApps to mobile XELIS wallets through a relay server with end-to-end encryption. Perfect for scenarios where direct WebSocket connections aren't possible (mobile, different networks, etc.).

## Features

- 🔒 End-to-end encryption (AES-GCM or ChaCha20-Poly1305)
- 📱 QR code-based pairing
- 🌐 Works across devices and networks
- 🔌 Drop-in replacement for direct XSWD connections
- 🛡️ Zero trust - relay server never sees plaintext

Built on top of [xswd-relayer](https://github.com/xelis-project/xswd-relayer) for secure peer-to-peer WebSocket tunneling.
