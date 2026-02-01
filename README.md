<div align="center">
  <img width=320" height="320" src=".github/logo.svg" />
  <br>
  <h1>Arterial</h1>
  <p>(WIP) A self-healing communication layer for adaptive and resilient systems</p>
</div>

**Arterial** is a transport-agnostic RPC and Event bridge designed to create resilient, "venous" communication graphs. It allows you to invoke methods and propagate events across boundaries (processes, threads, or networks) without your application logic knowing _how_ the message travels.

It is designed to support high-availability failover (e.g., swapping from a local MessagePort to a remote WebSocket) without interrupting the application flow.

## Features

- **Transport Agnostic:** Run the exact same logic over `MessagePort` (Electron/Workers) or `WebSocket` (Network).
- **Venous Graph:** Nodes are isolated by a `venousId`, allowing multiple private networks to coexist on the same transport.
- **Typed RPC:** Strict TypeScript support for method invocation and return types.
- **Resilience:** (Coming Soon) Automatic failover to backup transports if the primary "artery" is severed.

## Installation

```bash
npm install arterial
```

## Quick Start

Arterial uses a **Stem** (Originator/Server) and **Consumer** (Receiver/Client) model to establish the connection, but once connected, communication is bidirectional.

### 1. The Compute Node (Stem)

This acts as the "Server" or the provider of the heavy compute.

```typescript
import { WebSocketServer } from 'ws';
import createArterial, { websocketStem } from 'arterial';

// 1. Setup the physical transport
const wss = new WebSocketServer({ port: 8080 });
const stemTransport = websocketStem({ wss });

// 2. Create the Arterial Node
const computeNode = createArterial({
	id: 'compute-node-1',
	venousId: 'sys-core-v1', // The unique ID of this "vein"
	primaryDestinationId: 'client-app',
	transports: [stemTransport]
});

// 3. Register methods other nodes can call
computeNode.registerMethod('math-sum', (numbers: number[]) => {
	return numbers.reduce((a, b) => a + b, 0);
});

// 4. Open the artery
await computeNode.init();
console.log('Compute Node Ready');
```

### 2. The Application Node (Consumer)

This acts as the "Client" or the UI thread.

```typescript
import createArterial, { websocketConsumer } from 'arterial';

// 1. Setup the transport (Dialing the Stem)
const consumerTransport = websocketConsumer({ url: 'ws://localhost:8080' });

// 2. Create the Arterial Node
const appNode = createArterial({
	id: 'client-app',
	venousId: 'sys-core-v1', // Must match the Stem!
	primaryDestinationId: 'compute-node-1',
	transports: [consumerTransport]
});

// 3. Open the artery
await appNode.init();

// 4. Invoke a method on the remote node
// Generic: <MethodSignature> (DestinationID, MethodName, Args)
const result = await appNode.invoke<(nums: number[]) => number>('compute-node-1', 'math-sum', [[10, 20, 30]]);

console.log(result); // 60
```

## Creating Stable Proxies

Instead of using string-based invocation every time, you can create a stable proxy function for cleaner code:

```typescript
// Create a reusable function handle
const sumRemote = appNode.method<typeof localSumSignature>('compute-node-1', 'math-sum');

// Use it like a normal async function
const total = await sumRemote([1, 2, 3]);
```

## Configuration

### `createArterial(options)`

| Option                 | Type          | Description                                                                        |
| ---------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `string`      | The unique identifier for _this_ specific node.                                    |
| `venousId`             | `string`      | The network ID. Nodes with different `venousId`s ignore each other.                |
| `primaryDestinationId` | `string`      | The default target for initial handshakes.                                         |
| `transports`           | `Transport[]` | An array of initialized transports (e.g., `websocketStem`, `messagePortConsumer`). |

## Transports

Arterial ships with two core transports:

### `messagePort`

Ideal for Electron `UtilityProcess`, `Worker` threads, or `Iframe` communication.

```typescript
import { messagePortStem, messagePortConsumer } from 'arterial/transports/messagePort';
```

### `websocket`

Ideal for communicating between a browser and a backend service, or between microservices.

```typescript
import { websocketStem, websocketConsumer } from 'arterial/transports/websocket';
```
