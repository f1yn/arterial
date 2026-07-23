import type { Arterial } from "./arterial";

/**
 * Envelope for all arterial wire messages. Nodes filter by `venousId` and route by `destinationId`.
 * The `as` field distinguishes handshakes, RPC, heartbeats, and errors.
 */
export interface ArterialMessage<DataType = any> {
	sourceId: string;
	destinationId: string;
	venousId: string;
	as: 'invoke' | 'invoke-result' | 'invoke-error' | 'pulse' | 'ready' | 'ready-ack'
	data: DataType;
}

export type ArterialMessageInvokeData = {
	idempotencyKey: string;
	methodName: string;
	args: unknown[];
}

export type ArterialMessageInvokeResultData<ResultType = unknown> = ArterialMessageInvokeData & {
	result: ResultType;
	resultError?: string;
}

export type ArterialPrimaryLoopType = (message: ArterialMessage, transport: ArterialTransportConsumer) => Promise<void>;

/**
 * Contract for a physical transport adapter. Transports are tried in array order during failover.
 * `init` wires the node loop; `connect` performs the handshake; `sendMessage` returns false when unavailable.
 */
export type ArterialTransportConsumer = {
	connect: () => Promise<void>;
	init: (arterial: Arterial, primaryArterialLoop: ArterialPrimaryLoopType) => Promise<void>;
	sendMessage: <DataType = unknown>(message: ArterialMessage<DataType>) => Promise<boolean>;
	isStem?: boolean;
	isHealthy?: () => boolean;
	onDisconnect?: (callback: () => void) => void;
	disconnect?: () => void;
}

export function createFlatPromise<ResultType = void>() {
	let resolveRef: (result: ResultType | PromiseLike<ResultType>) => void;
	let rejectRef: (reason?: any) => void;

	const returnPromise = new Promise<ResultType>((resolve, reject) => {
		resolveRef = resolve;
		rejectRef = reject;
	});

	return [returnPromise, resolveRef!, rejectRef!] as const;
}
