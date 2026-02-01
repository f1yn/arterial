
import {
	type ArterialMessage,
	type ArterialMessageInvokeData,
	type ArterialMessageInvokeResultData,
	type ArterialTransportConsumer,
	createFlatPromise
} from "./shared";

interface ArterialBaseOptions {
	id: string;
	venousId: string;
	primaryDestinationId: string;
	transports: ArterialTransportConsumer[],
}

export type Arterial = ReturnType<typeof createArterial>

export type ArterialBroadcastSubscription = (message: ArterialMessage) => Promise<void> | void;

export type DefaultCallable = (...anyArgs: any[]) => any;


// IMPORTANT: Within the process context, ensure that we link any nodes on the same venousId (even if they don't talk
// directory talk to eachother)
export default function createArterial({ id, venousId, primaryDestinationId, transports }: ArterialBaseOptions) {
	const subscriptions = new Set<ArterialBroadcastSubscription>();
	const allRegisteredMethods = new Map<string, DefaultCallable>();

	/**
	 * @private
	 * Sends an arterial message through the first viable transport. Explodes if all transports don't send.
	 * @param message
	 */
	async function sendToAvailableTransport<DataType = unknown>(message: ArterialMessage<DataType>) {
		for (const transport of transports) {
			const wasFine = await transport.sendMessage(message);
			if (wasFine) return;
		}

		throw new Error('FATAL: No transports are accepting pushes!')
	}

	/**
	 * @private
	 * Handles the processing of incoming Arterial messages (from all transports)
	 * @param message
	 * @returns
	 */
	async function primaryArterialLoop(message: ArterialMessage) {
		// We skip events not from this graph
		if (message.venousId !== venousId) return;

		for (const subscription of subscriptions) {
			await subscription(message)
		}

		// Opt into the invocation request
		if (message.as === 'invoke' && message.destinationId === id) {
			const data = message.data as ArterialMessageInvokeData;

			try {
				const method = allRegisteredMethods.get(data.methodName);
				if (!method) {
					throw new Error('The provided method is not recognized on this instance')
				}

				const result = await method(...(data.args || []));

				// Return the result via available transports
				await sendToAvailableTransport<ArterialMessageInvokeResultData>({
					as: 'invoke-result',
					sourceId: id,
					destinationId: message.destinationId,
					venousId,
					data: {
						idempotencyKey: data.idempotencyKey,
						methodName: data.methodName,
						args: data.args,
						result,
					},
				});
			} catch (methodError) {
				// Flag that we hit a wall
				await sendToAvailableTransport<ArterialMessageInvokeResultData>({
					as: 'invoke-error',
					sourceId: id,
					destinationId: message.destinationId,
					venousId,
					data: {
						idempotencyKey: data.idempotencyKey,
						methodName: data.methodName,
						args: data.args,
						result: null,
						resultError: (methodError as Error).toString()
					},
				});
			}
		}
	}

	/**
	 * Sends a pulse via all transports
	 * @param destinationId
	 * @param data
	 */
	async function pulse(destinationId: string) {
		// TODO: As we approach a resilience graph, we should consider this being
		// the heartbeat creator (and have it permeate outwards in the graph from the core)
		for (const transport of transports) {
			transport.sendMessage({
				as: 'pulse',
				sourceId: id,
				destinationId,
				venousId,
				data: Date.now(),
			});
		}
	}

	/**
	 * Waits for a specific condition to be met on the arterrial
	 */
	function waitFor<DataType = unknown>(checkCondition: (message: ArterialMessage<DataType>) => boolean | void): Promise<ArterialMessage<DataType>> {
		const [resultPromise, resolveWithMessage] = createFlatPromise<ArterialMessage<DataType>>();

		function waitForPrecondition(message: ArterialMessage<DataType>) {
			if (checkCondition(message)) {
				subscriptions.delete(waitForPrecondition);
				resolveWithMessage(message);
			}
		}

		subscriptions.add(waitForPrecondition);

		return resultPromise;
	}

	async function invoke<MethodType extends DefaultCallable>(destinationId: string, methodName: string, args: Parameters<MethodType>) {
		const idempotencyKey = `${methodName}_${Math.random().toString(16)}`;

		type ResultType = ReturnType<MethodType>;

		// IMPORTANT: Add the listener before we send the invocation!
		// Wait for the resulting value explicitly (either or a pass, or a failure)
		const pendingResultMessage = waitFor<ArterialMessageInvokeResultData<ResultType>>((message) => (
			message.data.idempotencyKey === idempotencyKey &&
			(message.as === 'invoke-result' || message.as === 'invoke-error')
		));

		await sendToAvailableTransport<ArterialMessageInvokeData>({
			as: 'invoke',
			sourceId: id,
			destinationId,
			venousId,
			data: {
				idempotencyKey,
				methodName,
				args,
			},
		});

		const resultMessage = await pendingResultMessage;

		if (resultMessage.as === 'invoke-error') {
			throw new Error(resultMessage.data.resultError);
		}

		// IMPORTANT: We assert the return type here!
		return resultMessage.data.result;
	}

	/**
	 * A higher order function that returns a stable callable proxy to the remote function
	 */
	function method<MethodType extends DefaultCallable>(destinationId: string, method: string) {
		return (...args: Parameters<MethodType>) => invoke<MethodType>(destinationId, method, args);
	}

	/**
	 * Registers a method for invocation by other nodes connected to this arterial
	 * @param name The method name to register
	 * @param methodHandler
	 */
	function registerMethod(name: string, methodHandler: DefaultCallable) {
		allRegisteredMethods.set(name, methodHandler);
	}

	// Create lite object instance (for handover to the Arterial)
	const arterial = {
		config: {
			id,
			venousId,
			primaryDestinationId,
		},
		invoke,
		method,
		registerMethod,
		waitFor,
		pulse,
		init,
	}

	async function init() {
		// TODO: un-init transports if already stately ran
		const connections = [];

		for (const transport of transports) {
			transport.init(arterial, primaryArterialLoop);
			connections.push(transport.connect())
		}

		await Promise.all(connections);
	}

	return arterial;
}