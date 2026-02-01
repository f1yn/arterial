import type { Arterial } from "./arterial";

export interface ArterialMessage<DataType = any> {
	sourceId: string;
	destinationId: string;
	venousId: string;
	as: 'invoke' | 'invoke-result' | 'invoke-error' | 'pulse' | 'ready' | 'ready-awk'
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

export type ArterialTransportConsumer = {
	init: (arterial: Arterial, primaryArterialLoop: (message: ArterialMessage, transport: ArterialTransportConsumer) => Promise<void>) => Promise<void>;
	sendMessage: <DataType = unknown>(message: ArterialMessage<DataType>) => Promise<boolean>;
	isStem?: boolean;
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