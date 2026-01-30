import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { startServer } from '../src/index';
import { Server } from 'http';

describe('Server Latency', () => {
    let server: Server;
    const LAG = 50;

    beforeAll(() => {
        server = startServer(0, 'localhost', { serverLagBefore: LAG });
    });

    afterAll(() => {
        server.close();
    });

    it('should respect serverLagBefore', async () => {
        const start = Date.now();
        const response = await request(server).get('/drive/v3/about');
        const duration = Date.now() - start;

        expect(response.status).toBe(401); // Auth middleware runs AFTER lag? No, lag is top middleware.
        expect(duration).toBeGreaterThanOrEqual(LAG);
    });
});
