# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Test infrastructure: Vitest config, coverage support, GitHub Actions CI
- Feature test suite covering RPC, venous graph isolation, reconnection, and failover
- Transport health tracking (`isHealthy`, `onDisconnect`, `disconnect`)
- Multi-transport failover with priority-ordered transport selection
- Transport-local WebSocket handshake (fixes false-ready when multiple transports are active)
- Reply routing via the transport that received the request
- Re-exports of transport factories from the main `arterial` entry point

### Fixed

- `invoke-result` and `invoke-error` messages now route to the caller (`destinationId: message.sourceId`)
- `invoke` waitFor matcher guards against non-invoke messages and validates `destinationId`
- WebSocket consumer reconnect configurable via `reconnect` and `reconnectDelayMs` options

## [0.0.4]

- Initial release with MessagePort and WebSocket transports
- Typed RPC via `invoke` and `method` proxies
- Stem/consumer handshake model
