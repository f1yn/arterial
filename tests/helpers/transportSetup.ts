import { WebSocketServer } from 'ws';
import { createFlatPromise } from '../../src/shared';
import type { ArterialMessage, ArterialPrimaryLoopType, ArterialTransportConsumer } from '../../src/shared';
import { messagePortStem, messagePortConsumer } from '../../src/transports/messagePort';
import { websocketStem, websocketConsumer } from '../../src/transports/websocket';

const activeSockets = new Set<WebSocketServer>();

/** Terminates all clients and closes every WebSocket server created by test helpers. */
export async function closeAllWebSocketServers() {
	const closers = [...activeSockets].map(async (wss) => {
		for (const client of wss.clients) {
			client.terminate();
		}
		await new Promise<void>((resolve) => wss.close(() => resolve()));
	});
	activeSockets.clear();
	await Promise.all(closers);
}

/**
 * Models a single network socket between a stem and consumer node.
 * WebSocket consumer has `reconnect: false` to avoid hanging test cleanup.
 */
export function createWebSocketTransportPair() {
	const wss = new WebSocketServer({ port: 0 });
	activeSockets.add(wss);
	const address = wss.address();
	const port = typeof address === 'object' && address ? address.port : 0;

	return [
		websocketStem({ wss }),
		websocketConsumer({ url: `ws://localhost:${port}`, reconnect: false }),
		{ wss, port },
	] as const;
}

/** Models a single local MessageChannel between a stem and consumer node. */
export function createMessagePortTransportPair() {
	const [pendingReceivedPort, setReceivedPort] = createFlatPromise<MessagePort>();

	const stemTransport = messagePortStem({
		sendPort(destPort) {
			setReceivedPort(destPort);
		},
	});

	const consumerTransport = messagePortConsumer({
		getPort: () => pendingReceivedPort,
	});

	return { stemTransport, consumerTransport };
}

/**
 * Models a MessagePort pair with explicit disconnect control.
 * Used when tests need to sever the local artery mid-scenario.
 */
export function createControllableMessagePortPair() {
	const [pendingPort, setPort] = createFlatPromise<MessagePort>();

	const stemTransport = messagePortStem({
		sendPort(port) {
			setPort(port);
		},
	});

	const consumerTransport = messagePortConsumer({
		getPort: () => pendingPort,
	});

	return {
		stemTransport,
		consumerTransport,
		disconnectMessagePort() {
			stemTransport.disconnect?.();
			consumerTransport.disconnect?.();
		},
	};
}

/**
 * Models an Electron-style dual-transport node: MessagePort primary, WebSocket backup.
 * See `docs/system-models.md` schematic B and `failover.test.ts`.
 */
export function createDualTransportPair() {
	const mp = createControllableMessagePortPair();
	const [wsStem, wsConsumer, { wss, port }] = createWebSocketTransportPair();

	return {
		stemTransports: [mp.stemTransport, wsStem] as ArterialTransportConsumer[],
		consumerTransports: [mp.consumerTransport, wsConsumer] as ArterialTransportConsumer[],
		disconnectMessagePort: mp.disconnectMessagePort,
		disconnectWebSocket() {
			wsStem.disconnect?.();
			wsConsumer.disconnect?.();
			for (const client of wss.clients) {
				client.terminate();
			}
			wss.close();
		},
		wss,
		port,
	};
}

type BusPeer = {
	loop: ArterialPrimaryLoopType;
	transport: ArterialTransportConsumer;
	nodeId: string;
};

/**
 * Models multiple venous graphs sharing one physical wire.
 * Used to prove `venousId` isolation without separate transport instances.
 */
export function createSharedBus() {
	const peers = new Set<BusPeer>();

	function createTransport(): ArterialTransportConsumer {
		let nodeId = '';
		let loop: ArterialPrimaryLoopType = async () => {};

		const transport: ArterialTransportConsumer = {
			init(arterial, primaryArterialLoop) {
				nodeId = arterial.config.id;
				loop = primaryArterialLoop;
				peers.add({ loop, transport, nodeId });
			},
			async connect() {},
			async sendMessage(message: ArterialMessage) {
				for (const peer of peers) {
					if (peer.nodeId !== message.sourceId) {
						await peer.loop(message, peer.transport);
					}
				}
				return true;
			},
			isHealthy: () => true,
		};

		return transport;
	}

	return { createTransport };
}

/** Races an invoke against a timeout — for negative cases where no response should arrive. */
export function invokeWithTimeout<T>(
	promise: Promise<T>,
	timeoutMs = 2000,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error('invoke timed out')), timeoutMs),
		),
	]);
}
