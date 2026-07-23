# Test Suite

Requires Node.js 22 or later.

## Running

```bash
npm install
npm run test:run        # run all tests once
npm test                # watch mode
npm run test:coverage   # run with coverage report
```

## Feature Matrix

| README promise | Test file | Scenario |
|----------------|-----------|----------|
| Transport agnostic | `rpc.test.ts` | Parametrized over MessagePort and WebSocket |
| Typed RPC (`invoke`, `method`) | `rpc.test.ts` | Remote method invocation with typed proxies |
| Error bubbling | `rpc.test.ts` | Unknown method throws on callee |
| Handler exception propagation | `rpc.test.ts` | Remote handler error reaches caller |
| Bidirectional RPC | `rpc.test.ts` | Stem invokes consumer after consumer invokes stem |
| `waitFor` / `pulse` | `rpc.test.ts` | Pulse delivery and subscription matching |
| Venous graph isolation | `isolation.test.ts` | Cross-`venousId` invoke times out on shared wire |
| MessagePort re-handshake | `resilience.test.ts` | Consumer reloads; stem stays alive |
| WebSocket auto-reconnect | `resilience.test.ts` | Server restart; consumer reconnects after backoff |
| Failover (closed port) | `failover.test.ts` | MessagePort severed; WebSocket backup used |
| Failover (closed socket) | `failover.test.ts` | WebSocket severed; MessagePort backup used |
| Primary transport recovery | `failover.test.ts` | Restored MessagePort used after backup failover |
| Built output exports | `dist.test.ts` | `dist/` smoke test for packaging regressions |

## File Guide

### `rpc.test.ts`

Models a two-node stem/consumer pair on a single transport. Each test runs against both MessagePort and WebSocket to prove transport agnosticism.

| Test | Models |
|------|--------|
| `handles initialization` | Handshake completes without error |
| `handles method invocation` | `invoke` and `method` proxy return typed results |
| `bubbles exception for non-mapped invocations` | Callee rejects unknown method names |
| `propagates handler exceptions to the caller` | `invoke-error` crosses the wire |
| `supports bidirectional RPC` | Either node can call the other after connect |
| `delivers pulse messages via waitFor` | Heartbeat-style message subscription |

### `isolation.test.ts`

Models multiple venous graphs sharing one physical wire via a test-only shared bus. Proves `venousId` filtering prevents cross-graph RPC.

### `resilience.test.ts`

Models connection recovery without tearing down the whole graph.

| Test | Models |
|------|--------|
| `re-handshakes MessagePort when consumer reloads` | Electron UI reload: new consumer instance, same stem |
| `reconnects WebSocket consumer after server restart` | Network blip: server dies and restarts, consumer auto-reconnects |

### `failover.test.ts`

Models a node with dual transports (MessagePort primary, WebSocket backup). See `docs/system-models.md` schematic B.

| Test | Models |
|------|--------|
| `handles failover in order of priority (closed port)` | Local artery severed; network backup carries traffic |
| `handles failover in order of priority (closed socket)` | Network artery severed; local backup carries traffic |
| `recovers primary transport after restoration` | Failover to backup, then primary restored and preferred |

### `dist.test.ts`

Verifies the built `dist/` output exports match `package.json` — catches bundling and re-export regressions.

### `helpers/transportSetup.ts`

Test factories that simulate physical topologies. See JSDoc on each export.

## Adding Tests

- **Parametrize transports** when behavior should be transport-agnostic (`['MessagePort', 'WebSocket'].forEach(...)`).
- **Clean up WebSocket servers** in `afterEach` via `closeAllWebSocketServers()` — consumers with `reconnect: true` will otherwise hang cleanup.
- **Use `invokeWithTimeout`** for negative cases where a message should never arrive (e.g. cross-venous isolation).
- **Use `createDualTransportPair`** when testing failover — it wires MessagePort + WebSocket with disconnect helpers.
- **Prefer modeling system behavior** in file-level comments: describe the topology being simulated, not just the assertion.
