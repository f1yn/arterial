import type { Arterial } from "../arterial";
import type { ArterialMessage, ArterialTransportConsumer, ArterialPrimaryLoopType } from "../shared";
import { type WebSocketServer, WebSocket as WsSocket } from "ws";

// WebSocket transport for network boundaries (browser ↔ backend, microservices).

function createTransportHealth() {
	let healthy = true;
	const disconnectCallbacks = new Set<() => void>();

	function markHealthy() {
		healthy = true;
	}

	function markUnhealthy() {
		if (!healthy) return;
		healthy = false;
		for (const callback of disconnectCallbacks) {
			callback();
		}
	}

	return {
		isHealthy: () => healthy,
		markHealthy,
		markUnhealthy,
		onDisconnect: (callback: () => void) => {
			disconnectCallbacks.add(callback);
		},
	};
}

/**
 * Stem side of a WebSocket transport. Listens on an existing `WebSocketServer` for consumer connections.
 */
export function websocketStem({ wss }: { wss: WebSocketServer }) {
	let context: { arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType };
	let socket: WsSocket;
	const health = createTransportHealth();

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		if (!health.isHealthy()) return false;
		if (!socket || socket.readyState !== WsSocket.OPEN) return false;
		try {
			socket.send(JSON.stringify(message));
			return true;
		} catch (transportError) {
			console.error('Transport error', transportError);
			health.markUnhealthy();
			return false;
		}
	}

	return {
		init(arterial, primaryArterialLoop) {
			context = { arterial, primaryArterialLoop }
		},
		async connect() {
			if (!context) throw new Error('Transport not initialized');
			const transport = this;

			wss.on('connection', (ws) => {
				socket = ws;
				health.markHealthy();

				ws.on('message', async (data) => {
					try {
						const message = JSON.parse(data.toString()) as ArterialMessage;

						if (message.as === 'ready' && message.destinationId === context!.arterial.config.id) {
							health.markHealthy();
							sendMessage({
								as: 'ready-ack',
								venousId: context.arterial.config.venousId,
								sourceId: context.arterial.config.id,
								destinationId: message.sourceId,
								data: null,
							});
							return;
						}

						await context.primaryArterialLoop(message, transport);
					} catch (e) {
						console.error('Stem WS Parse Error', e);
					}
				});

				ws.on('close', () => {
					health.markUnhealthy();
				});
			});
		},
		sendMessage,
		isStem: true,
		isHealthy: health.isHealthy,
		onDisconnect: health.onDisconnect,
		disconnect() {
			socket?.close();
			health.markUnhealthy();
		},
	} as ArterialTransportConsumer;
}

/**
 * Consumer side of a WebSocket transport. Dials `url` and auto-reconnects on close when `reconnect` is true.
 */
export function websocketConsumer({ url, reconnectDelayMs = 3000, reconnect = true }: { url: string; reconnectDelayMs?: number; reconnect?: boolean }) {
	let socket: WebSocket | null = null;
	let isConnecting = false;
	let gotReadyAck = false;
	let context: { arterial: Arterial; loop: ArterialPrimaryLoopType };
	const health = createTransportHealth();

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		if (!health.isHealthy()) return false;
		if (!socket || socket.readyState !== WebSocket.OPEN) return false;
		try {
			socket.send(JSON.stringify(message));
			return true;
		} catch (transportError) {
			console.error('Transport error', transportError);
			health.markUnhealthy();
			return false;
		}
	}

	function waitForHandshake() {
		return new Promise<void>((resolve, reject) => {
			const deadline = setTimeout(() => reject(new Error('WebSocket handshake timeout')), 10000);

			const wait = setInterval(() => {
				if (gotReadyAck && socket?.readyState === WebSocket.OPEN) {
					clearInterval(wait);
					clearTimeout(deadline);
					resolve();
				}
			}, 10);
		});
	}

	function establishConnection() {
		if (isConnecting || !context) return;
		isConnecting = true;
		gotReadyAck = false;

		const ws = new WebSocket(url);

		ws.onopen = () => {
			socket = ws;
			isConnecting = false;
			health.markHealthy();

			sendMessage({
				as: 'ready',
				venousId: context!.arterial.config.venousId,
				sourceId: context!.arterial.config.id,
				destinationId: context!.arterial.config.primaryDestinationId,
				data: null,
			});
		};

		ws.onmessage = async (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.as === 'ready-ack' && msg.sourceId === context!.arterial.config.primaryDestinationId) {
					gotReadyAck = true;
					health.markHealthy();
				}
				await context!.loop(msg, transport);
			} catch (e) { console.error('WS Parse Error', e); }
		};

		ws.onclose = () => {
			socket = null;
			isConnecting = false;
			gotReadyAck = false;
			health.markUnhealthy();
			if (reconnect) {
				setTimeout(establishConnection, reconnectDelayMs);
			}
		};
	};

	const transport = {
		init(arterial, primaryArterialLoop) {
			context = { arterial, loop: primaryArterialLoop };
		},

		async connect() {
			if (!context) throw new Error("Transport not initialized");
			establishConnection();
			// IMPORTANT: Wait for this transport's own handshake — not the shared arterial waitFor,
			// which would resolve early when another transport (e.g. MessagePort) acks first.
			await waitForHandshake();
		},
		sendMessage,
		isHealthy: health.isHealthy,
		onDisconnect: health.onDisconnect,
		disconnect() {
			socket?.close();
			health.markUnhealthy();
		},
	} as ArterialTransportConsumer;

	return transport;
}
