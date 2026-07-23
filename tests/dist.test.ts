/**
 * Verifies the built `dist/` output exports match package.json.
 * Catches bundling and re-export regressions before publish.
 */
import { execSync } from 'node:child_process';
import { expect, describe, it, beforeAll } from 'vitest';

describe('dist smoke', () => {
	beforeAll(() => {
		execSync('npm run build', { stdio: 'inherit' });
	});

	it('exports createArterial from built output', async () => {
		const mod = await import('../dist/arterial.mjs');
		expect(mod.default).toBeTypeOf('function');
	});

	it('exports transport factories from built output', async () => {
		const mod = await import('../dist/arterial.mjs');
		expect(mod.websocketStem).toBeTypeOf('function');
		expect(mod.websocketConsumer).toBeTypeOf('function');
		expect(mod.messagePortStem).toBeTypeOf('function');
		expect(mod.messagePortConsumer).toBeTypeOf('function');
	});

	it('exports subpath transports from built output', async () => {
		const ws = await import('../dist/transports/websocket.mjs');
		const mp = await import('../dist/transports/messagePort.mjs');
		expect(ws.websocketStem).toBeTypeOf('function');
		expect(mp.messagePortStem).toBeTypeOf('function');
	});
});
