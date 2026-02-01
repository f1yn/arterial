import { expect, describe, it, afterEach, beforeEach } from 'vitest'
import { WebSocketServer } from 'ws';
import { createFlatPromise } from '../src/shared';

import { messagePortStem, messagePortConsumer } from '../src/transports/messagePort';
import { websocketStem, websocketConsumer } from '../src/transports/websocket';
import createArterial from "../src/arterial";


describe('Arterial system', () => {
	const activeSockets = new Set<WebSocketServer>();

	afterEach(async () => {
		for (const wss of activeSockets) {
			wss.close()
		}
	});

	['MessagePort', 'WebSocket'].forEach((transportType) => {
		describe(`Single-transport tests - ${transportType}`, () => {
			const setup = async () => {
				if (transportType === 'WebSocket') {
					const port = 1234 + activeSockets.size + 1;
					const wss = new WebSocketServer({ port });
					activeSockets.add(wss);

					return [
						websocketStem({ wss }),
						websocketConsumer({ url: `ws://localhost:${port}` })
					] as const
				}

				const [pendingReceivedPort, setReceivedPort] = createFlatPromise<MessagePort>();

				// We only init the transports as needed (and per test suite)
				return [messagePortStem({
					// Send port to awaiting system
					sendPort(destPort) {
						setReceivedPort(destPort);
					},
				}), messagePortConsumer({
					getPort: () => pendingReceivedPort
				})] as const;
			}


			it('handles initialization', async () => {
				const [stemTransport, consumerTransport] = await setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport]
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport]
				});

				await Promise.all([nodeA.init(), nodeB.init()])
			})

			it('handles method invocation', async () => {
				const [stemTransport, consumerTransport] = await setup();

				// Server (handles the compute)
				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport]
				});

				// Register some server methods (that can be called by other nodes)
				const nodeBSumNumbers = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
				const nodeBSerialize = (complexCollection: any[]) => JSON.stringify(complexCollection);

				type SumNumbersCallType = typeof nodeBSumNumbers
				type SerializeCallType = typeof nodeBSerialize;

				nodeB.registerMethod('perform-add', nodeBSumNumbers)
				nodeB.registerMethod('perform-serialize', nodeBSerialize);

				// Consumer
				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport]
				});

				await Promise.all([nodeA.init(), nodeB.init()]);

				// Do a manual invocation
				const performAddResult = await nodeA.invoke<SumNumbersCallType>('nodeB', 'perform-add', [[10, 300, 500]])
				expect(performAddResult).to.equal(810)

				// Do a method (stable TS) call
				const serialize = nodeA.method<SerializeCallType>('nodeB', 'perform-serialize');
				const serializeResult = await serialize([{}, new Set(), 'HEY']);
				expect(serializeResult).to.equal('[{},{},"HEY"]')
			})

			it('bubbles exception for non-mapped invocations', async () => {
				const [stemTransport, consumerTransport] = await setup();

				const nodeB = createArterial({
					id: 'nodeB',
					venousId: 'my-network',
					primaryDestinationId: 'nodeA',
					transports: [stemTransport]
				});

				const nodeA = createArterial({
					id: 'nodeA',
					venousId: 'my-network',
					primaryDestinationId: 'nodeB',
					transports: [consumerTransport]
				});

				await Promise.all([nodeA.init(), nodeB.init()])
				await expect(nodeB.invoke('nodeA', 'perform-action', [null]))
					.rejects.toThrow(/The provided method/);

			});
		});
	});

	it.skip('handles failover in order of priority (closed port)', () => {

	});

	it.skip('handles failover in order of priority (closed socket)', () => {

	});

	it.skip('wont processes nodes on separate venialIds', async () => {

	})
})
