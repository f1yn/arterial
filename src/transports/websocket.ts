import type { Arterial } from "../arterial";
import type { ArterialMessage, ArterialTransportConsumer, ArterialPrimaryLoopType } from "../shared";
import { type WebSocketServer, WebSocket as WsSocket } from "ws";

export function websocketStem({ wss }: { wss: WebSocketServer }) {
	let context: { arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType };
	let socket: WsSocket;

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		if (!socket || socket.readyState !== WsSocket.OPEN) return false;
		try {
			socket.send(JSON.stringify(message));
			return true;
		} catch (transportError) {
			console.error('Transport error', transportError);
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

				ws.on('message', async (data) => {
					try {
						const message = JSON.parse(data.toString()) as ArterialMessage;

						// HANDSHAKE INTERCEPT
						// If a Consumer (re)loads and sends 'ready', we must ACK it immediately.
						// This allows the Consumer to finish its own connect() sequence.
						if (message.as === 'ready' && message.destinationId === context!.arterial.config.id) {
							sendMessage({
								as: 'ready-ack',
								venousId: context.arterial.config.venousId,
								sourceId: context.arterial.config.id,
								destinationId: message.sourceId,
								data: null,
							});
							return;
						}

						// Standard processing
						await context.primaryArterialLoop(message, transport);
					} catch (e) {
						console.error('Stem WS Parse Error', e);
					}
				});
			});
		},
		sendMessage,
		isStem: true,
	} as ArterialTransportConsumer;
}

export function websocketConsumer({ url }: { url: string }) {
	let socket: WebSocket | null = null;
	let isConnecting = false;
	let context: { arterial: Arterial; loop: any };

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		if (!socket || socket.readyState !== WebSocket.OPEN) return false;
		try {
			socket.send(JSON.stringify(message));
			return true;
		} catch (transportError) {
			console.error('Transport error', transportError);
			return false;
		}
	}


	// The isolated "Retry Loop" logic
	function establishConnection() {
		if (isConnecting || !context) return;
		isConnecting = true;

		const ws = new WebSocket(url);

		ws.onopen = () => {
			socket = ws;
			isConnecting = false;

			// Handshake: Announce we are ready
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
				// Standard processing
				await context!.loop(msg, transport);
			} catch (e) { console.error('WS Parse Error', e); }
		};

		ws.onclose = () => {
			socket = null;
			isConnecting = false;
			// Internal Backoff & Retry
			// This handles the "dev server reload" scenario automatically
			setTimeout(establishConnection, 3000);
		};
	};

	const transport = {
		// Phase 1: Sync Configuration
		init(arterial, primaryArterialLoop) {
			context = { arterial, loop: primaryArterialLoop };
		},

		// Phase 2: Async Connection (Blocking until ready)
		async connect() {
			if (!context) throw new Error("Transport not initialized");
			// Kick off the connection loop
			establishConnection();
			// BLOCK until the handshake completes.
			// This ensures the transport is valid before the app proceeds.
			await context.arterial.waitFor(msg => msg.as === 'ready-ack');
		},
		sendMessage,
	} as ArterialTransportConsumer;

	return transport;
}