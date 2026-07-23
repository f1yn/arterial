/**
 * Models multiple venous graphs coexisting on a shared wire.
 * Proves nodes ignore messages from a different `venousId`.
 */
import { expect, describe, it } from 'vitest';
import createArterial from '../src/arterial';
import { createSharedBus, invokeWithTimeout } from './helpers/transportSetup';

describe('Venous graph isolation', () => {
	it('wont process nodes on separate venousIds', async () => {
		const bus = createSharedBus();

		const nodeB = createArterial({
			id: 'nodeB',
			venousId: 'network-a',
			primaryDestinationId: 'nodeA',
			transports: [bus.createTransport()],
		});

		const nodeA = createArterial({
			id: 'nodeA',
			venousId: 'network-a',
			primaryDestinationId: 'nodeB',
			transports: [bus.createTransport()],
		});

		const nodeD = createArterial({
			id: 'nodeD',
			venousId: 'network-b',
			primaryDestinationId: 'nodeC',
			transports: [bus.createTransport()],
		});

		const nodeC = createArterial({
			id: 'nodeC',
			venousId: 'network-b',
			primaryDestinationId: 'nodeD',
			transports: [bus.createTransport()],
		});

		nodeB.registerMethod('echo', (value: string) => value);

		await Promise.all([nodeA.init(), nodeB.init(), nodeC.init(), nodeD.init()]);

		const result = await nodeA.invoke<(v: string) => string>('nodeB', 'echo', ['hello']);
		expect(result).to.equal('hello');

		await expect(
			invokeWithTimeout(nodeC.invoke('nodeB', 'echo', ['wrong-network']), 1000),
		).rejects.toThrow(/timed out/);
	});
});
