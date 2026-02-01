
import type { ArterialMessage, ArterialTransportConsumer } from "../shared";
import { type WebSocketServer, WebSocket as WsSocket } from "ws";

export function websocketStem({ wss }: { wss: WebSocketServer }) {
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
		async init(arterial, primaryArterialLoop) {
			socket = await new Promise<WsSocket>((resolve) => {
				wss.once('connection', (ws) => resolve(ws));
			});

			// Setup the incoming message listener
			socket.on('message', async (data) => {
				try {
					const parsedMessage = JSON.parse(data.toString()) as ArterialMessage;
					console.log(parsedMessage);
					await primaryArterialLoop(parsedMessage, this);
				} catch (e) {
					console.error('Failed to parse incoming WS message', e);
				}
			});

			const pendingResponse = arterial.waitFor((message) => (
				message.as === 'ready' &&
				message.sourceId === arterial.config.primaryDestinationId
			));

			await pendingResponse;

			await sendMessage({
				as: 'ready-awk',
				venousId: arterial.config.venousId,
				sourceId: arterial.config.id,
				destinationId: arterial.config.primaryDestinationId,
				data: null,
			});
		},
		sendMessage,
		isStem: true,
	} as ArterialTransportConsumer;
}

export function websocketConsumer({ url }: { url: string }) {
	let socket: WebSocket;

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

	return {
		async init(arterial, primaryArterialLoop) {
			socket = new WebSocket(url);

			await new Promise<void>((resolve, reject) => {
				socket.onopen = () => resolve();
				socket.onerror = (err) => reject(err);
			});

			socket.onmessage = async (event) => {
				try {
					const parsedMessage = JSON.parse(event.data) as ArterialMessage;
					await primaryArterialLoop(parsedMessage, this);
				} catch (e) {
					console.error('Failed to parse incoming WS message', e);
				}
			};

			await sendMessage({
				as: 'ready',
				venousId: arterial.config.venousId,
				sourceId: arterial.config.id,
				destinationId: arterial.config.primaryDestinationId,
				data: null,
			});

			await arterial.waitFor((message) =>
				message.as === 'ready-awk' &&
				message.sourceId === arterial.config.primaryDestinationId
			);
		},
		sendMessage,
	} as ArterialTransportConsumer;
}