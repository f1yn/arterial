import type { Arterial } from "../arterial";
import type { ArterialMessage, ArterialTransportConsumer, ArterialPrimaryLoopType } from "../shared";

// MessagePort transport for same-machine boundaries (Electron utility processes, Workers, iframes).

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
 * Stem side of a MessagePort transport. Creates a channel and delivers `port2` via `sendPort`.
 */
export function messagePortStem({ sendPort }: { sendPort: (port: MessagePort) => Promise<void> | void }) {
	let context: { arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType };
	let stemPort: MessagePort;
	const health = createTransportHealth();

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		if (!health.isHealthy()) return false;
		try {
			stemPort.postMessage(message);
			return true
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

			const channel = new MessageChannel();
			stemPort = channel.port1;

			stemPort.onmessage = async (event) => {
				const message = event.data as ArterialMessage;

				// Handles the case where the Consumer (UI) reloaded, but this Stem (Worker) stayed alive.
				if (message.as === 'ready') {
					health.markHealthy();
					await sendMessage({
						as: 'ready-ack',
						venousId: context.arterial.config.venousId,
						sourceId: context.arterial.config.id,
						destinationId: message.sourceId,
						data: null,
					});
					return;
				}

				await context.primaryArterialLoop(message, transport);
			};

			stemPort.onmessageerror = () => health.markUnhealthy();

			health.markHealthy();
			await sendPort(channel.port2);
		},
		sendMessage,
		isStem: true,
		isHealthy: health.isHealthy,
		onDisconnect: health.onDisconnect,
		disconnect() {
			stemPort?.close();
			health.markUnhealthy();
		},
	} as ArterialTransportConsumer
}

/**
 * Consumer side of a MessagePort transport. Receives a port via `getPort` and performs the ready handshake.
 */
export function messagePortConsumer({ getPort }: { getPort: () => Promise<MessagePort> | MessagePort }) {
	let context: { arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType };
	let consumerPort: MessagePort;
	const health = createTransportHealth();

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		if (!health.isHealthy()) return false;
		try {
			consumerPort.postMessage(message);
			return true
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
			if (!context) throw new Error("Transport not initialized");
			const transport = this;

			consumerPort = await getPort();

			consumerPort.onmessage = async (event) => {
				const message = event.data as ArterialMessage;
				if (message.as === 'ready-ack') {
					health.markHealthy();
				}
				await context.primaryArterialLoop(message, transport);
			};

			consumerPort.onmessageerror = () => health.markUnhealthy();

			health.markHealthy();

			await sendMessage({
				as: 'ready',
				venousId: context.arterial.config.venousId,
				sourceId: context.arterial.config.id,
				destinationId: context.arterial.config.primaryDestinationId,
				data: null,
			});

			await context.arterial.waitFor((message) =>
				message.as === 'ready-ack' &&
				message.sourceId === context!.arterial.config.primaryDestinationId
			);
		},
		sendMessage,
		isHealthy: health.isHealthy,
		onDisconnect: health.onDisconnect,
		disconnect() {
			consumerPort?.close();
			health.markUnhealthy();
		},
	} as ArterialTransportConsumer;
}
