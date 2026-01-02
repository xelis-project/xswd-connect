# xswd-connect

**Secure cross-device connections for XSWD protocol**

Connect web dApps to mobile XELIS wallets through a relay server with end-to-end encryption. Perfect for scenarios where direct WebSocket connections aren't possible (mobile, different networks, etc.).

## Features

- 🔒 **End-to-end encryption** - AES-256-GCM encryption (ChaCha20-Poly1305 coming soon)
- 📱 **QR code-based pairing** - Simple scan-to-connect workflow
- 🌐 **Cross-device & cross-network** - Works anywhere WebSocket does
- 🔌 **Drop-in replacement** - Use with existing XSWD clients
- 🛡️ **Zero trust** - Relay server never sees plaintext messages
- 🚀 **Easy integration** - As simple as WalletConnect

Built on top of [xswd-relayer](https://github.com/xelis-project/xswd-relayer) for secure peer-to-peer WebSocket tunneling.
