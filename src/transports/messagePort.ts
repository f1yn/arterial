import type { Arterial } from "../arterial";
import type { ArterialMessage, ArterialTransportConsumer, ArterialPrimaryLoopType } from "../shared";

export function messagePortStem({ sendPort }: { sendPort: (port: MessagePort) => Promise<void> | void }) {
	let context: { arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType };
	let stemPort: MessagePort;

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		try {
			stemPort.postMessage(message);
			return true
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

			const channel = new MessageChannel();
			stemPort = channel.port1;

			stemPort.onmessage = async (event) => {
				const message = event.data as ArterialMessage;

				// Handles the case where the Consumer (UI) reloaded, but this Stem (Worker) stayed alive.
				if (message.as === 'ready') {
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

			// Send the other end of the pipe to the consumer
			await sendPort(channel.port2);
		},
		sendMessage,
		isStem: true,
	} as ArterialTransportConsumer
}

export function messagePortConsumer({ getPort }: { getPort: () => Promise<MessagePort> | MessagePort }) {
	let context: { arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType };
	let consumerPort: MessagePort;

	async function sendMessage<DataType = unknown>(message: ArterialMessage<DataType>) {
		try {
			consumerPort.postMessage(message);
			return true
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
			if (!context) throw new Error("Transport not initialized");
			const transport = this;

			// Get the physical port (this might wait for the iframe/worker to spawn)
			consumerPort = await getPort();

			// Bind listeners
			consumerPort.onmessage = async (event) => {
				await context.primaryArterialLoop(event.data, transport);
			};

			// Send Handshake
			await sendMessage({
				as: 'ready',
				venousId: context.arterial.config.venousId,
				sourceId: context.arterial.config.id,
				destinationId: context.arterial.config.primaryDestinationId,
				data: null,
			});

			// Wait for ACK
			await context.arterial.waitFor((message) =>
				message.as === 'ready-ack' &&
				message.sourceId === context!.arterial.config.primaryDestinationId
			);
		},
		sendMessage,
	} as ArterialTransportConsumer;
}
