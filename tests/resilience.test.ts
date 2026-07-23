/**
 * Models connection recovery without tearing down the whole graph.
 * Covers Electron consumer reload (MessagePort) and network server restart (WebSocket).
 */
import { expect, describe, it, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { createFlatPromise } from '../src/shared';
import createArterial from '../src/arterial';
import { messagePortStem, messagePortConsumer } from '../src/transports/messagePort';
import { websocketStem, websocketConsumer } from '../src/transports/websocket';
import { closeAllWebSocketServers } from './helpers/transportSetup';

describe('Resilience', () => {
	afterEach(async () => {
		await closeAllWebSocketServers();
	});

	it('re-handshakes MessagePort when consumer reloads', async () => {
		const [pendingPort, setPort] = createFlatPromise<MessagePort>();

		const stemTransport = messagePortStem({
			sendPort(port) {
				setPort(port);
			},
		});

		const nodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: [stemTransport],
		});

		nodeB.registerMethod('greet', (name: string) => `hello ${name}`);
		await nodeB.init();

		const makeConsumer = () =>
			createArterial({
				id: 'nodeA',
				venousId: 'my-network',
				primaryDestinationId: 'nodeB',
				transports: [
					messagePortConsumer({
						getPort: () => pendingPort,
					}),
				],
			});

		const nodeA = makeConsumer();
		await nodeA.init();

		const first = await nodeA.invoke<(n: string) => string>('nodeB', 'greet', ['world']);
		expect(first).to.equal('hello world');

		const reloadedNodeA = makeConsumer();
		await reloadedNodeA.init();

		const second = await reloadedNodeA.invoke<(n: string) => string>('nodeB', 'greet', ['again']);
		expect(second).to.equal('hello again');
	});

	it('reconnects WebSocket consumer after server restart', async () => {
		const port = 19876;
		let wss = new WebSocketServer({ port });
		const stemTransport = websocketStem({ wss });

		const nodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: [stemTransport],
		});

		nodeB.registerMethod('ping', () => 'pong');

		const nodeA = createArterial({
			id: 'nodeA',
			venousId: 'my-network',
			primaryDestinationId: 'nodeB',
			transports: [websocketConsumer({ url: `ws://localhost:${port}`, reconnectDelayMs: 50 })],
		});

		await nodeB.init();
		await nodeA.init();

		const first = await nodeA.invoke<() => string>('nodeB', 'ping', []);
		expect(first).to.equal('pong');

		for (const client of wss.clients) {
			client.terminate();
		}
		await new Promise<void>((resolve) => wss.close(() => resolve()));

		wss = new WebSocketServer({ port });
		const newNodeB = createArterial({
			id: 'nodeB',
			venousId: 'my-network',
			primaryDestinationId: 'nodeA',
			transports: [websocketStem({ wss })],
		});
		newNodeB.registerMethod('ping', () => 'pong');
		await newNodeB.init();

		await new Promise((resolve) => setTimeout(resolve, 150));

		const second = await nodeA.invoke<() => string>('nodeB', 'ping', []);
		expect(second).to.equal('pong');

		for (const client of wss.clients) {
			client.terminate();
		}
		await new Promise<void>((resolve) => wss.close(() => resolve()));
	}, 15000);
});
