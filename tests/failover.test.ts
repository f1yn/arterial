/**
 * Models a node with dual transports (MessagePort primary, WebSocket backup).
 * Verifies priority-ordered failover when one artery is severed, and primary recovery.
 */
import { expect, describe, it, afterEach } from 'vitest';
import { createFlatPromise } from '../src/shared';
import createArterial from '../src/arterial';
import { messagePortStem, messagePortConsumer } from '../src/transports/messagePort';
import { closeAllWebSocketServers, createDualTransportPair } from './helpers/transportSetup';

describe('Transport failover', () => {
	afterEach(async () => {
		await closeAllWebSocketServers();
	});

	it('handles failover in order of priority (closed port)', async () => {
		const { stemTransports, consumerTransports, disconnectMessagePort } = createDualTransportPair();

		const nodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: stemTransports,
		});

		const nodeA = createArterial({
			id: 'nodeA',
			venousId: 'my-network',
			primaryDestinationId: 'nodeB',
			transports: consumerTransports,
		});

		nodeB.registerMethod('add', (a: number, b: number) => a + b);

		await Promise.all([nodeA.init(), nodeB.init()]);

		const before = await nodeA.invoke<(a: number, b: number) => number>('nodeB', 'add', [2, 3]);
		expect(before).to.equal(5);

		disconnectMessagePort();

		const after = await nodeA.invoke<(a: number, b: number) => number>('nodeB', 'add', [4, 6]);
		expect(after).to.equal(10);
	});

	it('handles failover in order of priority (closed socket)', async () => {
		const { stemTransports, consumerTransports, disconnectWebSocket } = createDualTransportPair();

		const nodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: stemTransports,
		});

		const nodeA = createArterial({
			id: 'nodeA',
			venousId: 'my-network',
			primaryDestinationId: 'nodeB',
			transports: consumerTransports,
		});

		nodeB.registerMethod('add', (a: number, b: number) => a + b);

		await Promise.all([nodeA.init(), nodeB.init()]);

		const before = await nodeA.invoke<(a: number, b: number) => number>('nodeB', 'add', [1, 2]);
		expect(before).to.equal(3);

		disconnectWebSocket();

		const after = await nodeA.invoke<(a: number, b: number) => number>('nodeB', 'add', [3, 4]);
		expect(after).to.equal(7);
	});

	it('recovers primary transport after restoration', async () => {
		const dual = createDualTransportPair();

		const nodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: dual.stemTransports,
		});

		const nodeA = createArterial({
			id: 'nodeA',
			venousId: 'my-network',
			primaryDestinationId: 'nodeB',
			transports: dual.consumerTransports,
		});

		nodeB.registerMethod('add', (a: number, b: number) => a + b);

		await Promise.all([nodeA.init(), nodeB.init()]);

		dual.disconnectMessagePort();
		const viaBackup = await nodeA.invoke<(a: number, b: number) => number>('nodeB', 'add', [5, 5]);
		expect(viaBackup).to.equal(10);

		const [newPort, setNewPort] = createFlatPromise<MessagePort>();
		const restoredStem = messagePortStem({
			sendPort(port) {
				setNewPort(port);
			},
		});

		const restoredNodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: [restoredStem, dual.stemTransports[1]],
		});
		restoredNodeB.registerMethod('add', (a: number, b: number) => a + b);
		await restoredNodeB.init();

		const restoredNodeA = createArterial({
			id: 'nodeA',
			venousId: 'my-network',
			primaryDestinationId: 'nodeB',
			transports: [
				messagePortConsumer({ getPort: () => newPort }),
				dual.consumerTransports[1],
			],
		});
		await restoredNodeA.init();

		dual.disconnectWebSocket();
		await new Promise((resolve) => setTimeout(resolve, 100));

		const viaPrimary = await restoredNodeA.invoke<(a: number, b: number) => number>('nodeB', 'add', [2, 8]);
		expect(viaPrimary).to.equal(10);
	}, 15000);
});
