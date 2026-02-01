import type { ArterialMessage, ArterialTransportConsumer } from "../shared";

export function messagePortStem({ sendPort }: { sendPort: (port: MessagePort) => Promise<void> | void }) {
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
		async init(arterial, primaryArterialLoop) {
			const channel = new MessageChannel();
			stemPort = channel.port1;

			const primaryMessageHandler = async (rawMessage: any) => {
				// IMPORTANT: If needed, we can also specify the loop here
				await primaryArterialLoop(rawMessage.data as ArterialMessage, this);
			}

			stemPort.addEventListener('message', primaryMessageHandler);

			const pendingResponse = arterial.waitFor((message) => (
				message.as === 'ready' &&
				message.sourceId === arterial.config.primaryDestinationId
			));

			// Propagate to destination client (stacks through protocol)
			await sendPort(channel.port2);
			await pendingResponse;

			await sendMessage({
				as: 'ready-awk',
				venousId: arterial.config.venousId,
				sourceId: arterial.config.id,
				destinationId: arterial.config.primaryDestinationId,
				data: null,
			})
		},
		sendMessage,
		isStem: true,
	} as ArterialTransportConsumer
}

export function messagePortConsumer({ getPort }: { getPort: () => Promise<MessagePort> | MessagePort }) {
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
		async init(arterial, primaryArterialLoop) {
			// IMPORTANT: We need to potentially add the ability to poll this method
			consumerPort = await getPort();

			const primaryMessageHandler = async (rawMessage: any) => {
				// IMPORTANT: If needed, we can also specify the loop here
				await primaryArterialLoop(rawMessage.data as ArterialMessage, this);
			}

			consumerPort.addEventListener('message', primaryMessageHandler);

			await sendMessage({
				as: 'ready',
				venousId: arterial.config.venousId,
				sourceId: arterial.config.id,
				destinationId: arterial.config.primaryDestinationId,
				data: null,
			});

			await arterial.waitFor((message) => message.as === 'ready-awk' && message.sourceId === arterial.config.primaryDestinationId);
		},
		sendMessage,
	} as ArterialTransportConsumer;
}
