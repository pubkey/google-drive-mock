import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

// Helper (Shared)
import { Server } from 'http';

async function makeRequest(
    target: Server | string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown
) {
    if (typeof target === 'string') {
        const url = `${target}${path}`;
        const fetchOptions: RequestInit = {
            method: method,
            headers: headers
        };
        const res = await fetch(url, fetchOptions);
        const resBody = res.headers.get('content-type')?.includes('application/json')
            ? await res.json()
            : await res.text();

        return {
            status: res.status,
            body: resBody,
        };
    } else {
        const addr = target.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const baseUrl = `http://localhost:${port}`;
        return makeRequest(baseUrl, method, path, headers, body);
    }
}

describe('Server Latency', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should respect serverLagBefore', async () => {
        if (!config.isMock) {
            // Skip real
            return;
        }

        const start = Date.now();
        await makeRequest(config.target, 'GET', '/drive/v3/about', { 'Authorization': `Bearer ${config.token}` });
        const end = Date.now();

        const isNode = typeof process !== 'undefined' && process.env;
        const latency = isNode && process.env.LATENCY ? parseInt(process.env.LATENCY, 10) : 0;

        if (latency > 0) {
            expect(end - start).toBeGreaterThanOrEqual(latency);
        }
    });
});
