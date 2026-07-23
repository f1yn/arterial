/**
 * Models a two-node stem/consumer pair on a single transport.
 * Parametrized over MessagePort and WebSocket to prove transport-agnostic RPC.
 */
import { expect, describe, it, afterEach } from 'vitest';
import createArterial from '../src/arterial';
import {
	closeAllWebSocketServers,
	createMessagePortTransportPair,
	createWebSocketTransportPair,
} from './helpers/transportSetup';

describe('RPC', () => {
	afterEach(async () => {
		await closeAllWebSocketServers();
	});

	['MessagePort', 'WebSocket'].forEach((transportType) => {
		describe(`Single-transport tests - ${transportType}`, () => {
			const setup = () => {
				if (transportType === 'WebSocket') {
					const [stemTransport, consumerTransport] = createWebSocketTransportPair();
					return [stemTransport, consumerTransport] as const;
				}

				const { stemTransport, consumerTransport } = createMessagePortTransportPair();
				return [stemTransport, consumerTransport] as const;
			};

			it('handles initialization', async () => {
				const [stemTransport, consumerTransport] = setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport],
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport],
				});

				await Promise.all([nodeA.init(), nodeB.init()]);
			});

			it('handles method invocation', async () => {
				const [stemTransport, consumerTransport] = setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport],
				});

				const nodeBSumNumbers = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
				const nodeBSerialize = (complexCollection: unknown[]) => JSON.stringify(complexCollection);

				type SumNumbersCallType = typeof nodeBSumNumbers;
				type SerializeCallType = typeof nodeBSerialize;

				nodeB.registerMethod('perform-add', nodeBSumNumbers);
				nodeB.registerMethod('perform-serialize', nodeBSerialize);

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport],
				});

				await Promise.all([nodeA.init(), nodeB.init()]);

				const performAddResult = await nodeA.invoke<SumNumbersCallType>('nodeB', 'perform-add', [[10, 300, 500]]);
				expect(performAddResult).to.equal(810);

				const serialize = nodeA.method<SerializeCallType>('nodeB', 'perform-serialize');
				const serializeResult = await serialize([{}, new Set(), 'HEY']);
				expect(serializeResult).to.equal('[{},{},"HEY"]');
			});

			it('bubbles exception for non-mapped invocations', async () => {
				const [stemTransport, consumerTransport] = setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport],
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport],
				});

				await Promise.all([nodeA.init(), nodeB.init()]);
				await expect(nodeB.invoke('nodeA', 'perform-action', [null]))
					.rejects.toThrow(/The provided method/);
			});

			it('propagates handler exceptions to the caller', async () => {
				const [stemTransport, consumerTransport] = setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport],
				});

				nodeB.registerMethod('fail', () => {
					throw new Error('boom');
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport],
				});

				await Promise.all([nodeA.init(), nodeB.init()]);
				await expect(nodeA.invoke('nodeB', 'fail', [])).rejects.toThrow(/boom/);
			});

			it('supports bidirectional RPC', async () => {
				const [stemTransport, consumerTransport] = setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport],
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport],
				});

				nodeB.registerMethod('double', (n: number) => n * 2);
				nodeA.registerMethod('triple', (n: number) => n * 3);

				await Promise.all([nodeA.init(), nodeB.init()]);

				const doubled = await nodeA.invoke<(n: number) => number>('nodeB', 'double', [5]);
				expect(doubled).to.equal(10);

				const tripled = await nodeB.invoke<(n: number) => number>('nodeA', 'triple', [5]);
				expect(tripled).to.equal(15);
			});

			it('delivers pulse messages via waitFor', async () => {
				const [stemTransport, consumerTransport] = setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport],
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport],
				});

				await Promise.all([nodeA.init(), nodeB.init()]);

				const pulsePromise = nodeA.waitFor((message) => message.as === 'pulse');
				await nodeB.pulse('nodeA');

				const pulseMessage = await pulsePromise;
				expect(pulseMessage.as).to.equal('pulse');
				expect(pulseMessage.sourceId).to.equal('nodeB');
				expect(pulseMessage.destinationId).to.equal('nodeA');
			});
		});
	});
});
