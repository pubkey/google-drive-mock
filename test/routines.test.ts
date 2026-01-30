/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { waitUntil } from 'async-test-util';
import { startServer } from '../src/index';
import { driveStore } from '../src/store';
import { Server } from 'http';

describe('Complex Routines', () => {
    let server: Server;

    beforeAll(() => {
        driveStore.clear();
        const latency = process.env.LATENCY ? parseInt(process.env.LATENCY, 10) : 0;
        server = startServer(0, 'localhost', { serverLagBefore: latency });
    });

    afterAll(() => {
        server.close();
    });

    it('Lifecycle: Create -> Update -> Read -> Delete', async () => {
        // 1. Create
        const newFile = { name: 'Lifecycle File', mimeType: 'text/plain' };
        const createRes = await request(server)
            .post('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token')
            .send(newFile);
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        // 2. Update
        const updateRes = await request(server)
            .patch(`/drive/v3/files/${fileId}`)
            .set('Authorization', 'Bearer valid-token')
            .send({ name: 'Lifecycle Updated' });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.name).toBe('Lifecycle Updated');

        // 3. Read
        const readRes = await request(server)
            .get(`/drive/v3/files/${fileId}`)
            .set('Authorization', 'Bearer valid-token');
        expect(readRes.status).toBe(200);
        expect(readRes.body.name).toBe('Lifecycle Updated');

        // 4. Delete
        const deleteRes = await request(server)
            .delete(`/drive/v3/files/${fileId}`)
            .set('Authorization', 'Bearer valid-token');
        expect(deleteRes.status).toBe(204);

        // 5. Verify Deleted
        const verifyRes = await request(server)
            .get(`/drive/v3/files/${fileId}`)
            .set('Authorization', 'Bearer valid-token');
        expect(verifyRes.status).toBe(404);
    });

    it('Transaction Simulation: Lock -> Wait -> Release', async () => {
        const LOCK_FILE = 'transactions.txt';

        // Client A: Acquire Lock
        const createLock = await request(server)
            .post('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token')
            .send({ name: LOCK_FILE, mimeType: 'text/plain' });
        expect(createLock.status).toBe(200);
        const lockId = createLock.body.id;

        console.log('Client B starting loop to acquire lock...');

        // Concurrent: Client B polls, Client A releases after delay
        await Promise.all([
            // Client B: Loop until 'overwrite' works (Acquire (create) lock)
            waitUntil(async () => {
                // Check if lock file exists
                const check = await request(server)
                    .get('/drive/v3/files')
                    .set('Authorization', 'Bearer valid-token');

                const lockFile = check.body.files.find((f: any) => f.name === LOCK_FILE);

                if (lockFile) {
                    // Lock still held by A
                    // Verify we CANNOT overwrite/update it (ETag check simulation)
                    const failUpdate = await request(server)
                        .patch(`/drive/v3/files/${lockFile.id}`)
                        .set('Authorization', 'Bearer valid-token')
                        .set('If-Match', '"wrong-etag"')
                        .send({ name: 'Hacked' });
                    // Expect 412 or similar failure. 
                    expect(failUpdate.status).toBe(412);
                    return false; // Retry
                } else {
                    // Lock released by A, try to Acquire (Create)
                    const acquire = await request(server)
                        .post('/drive/v3/files')
                        .set('Authorization', 'Bearer valid-token')
                        .send({ name: LOCK_FILE, mimeType: 'text/plain' });

                    if (acquire.status === 200) {
                        return true; // Success
                    }
                    return false;
                }
            }, 4000, 50), // timeout, interval

            // Client A: Release Lock after 200ms
            new Promise<void>(resolve => {
                setTimeout(async () => {
                    await request(server)
                        .delete(`/drive/v3/files/${lockId}`)
                        .set('Authorization', 'Bearer valid-token');
                    resolve();
                }, 200);
            })
        ]);

        // Final check: Client B should hold the lock now
        const finalCheck = await request(server)
            .get('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token');
        const finalLock = finalCheck.body.files.find((f: any) => f.name === LOCK_FILE);
        expect(finalLock).toBeDefined();
        expect(finalLock.id).not.toBe(lockId); // Should be new ID
    });

    it('Routine: Write File Only If Not Exists (Concurrent Race)', async () => {
        const UNIQUE_FILE = 'unique.txt';

        // 1. Ensure clean state
        const check1 = await request(server)
            .get('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token');
        const exists1 = check1.body.files.find((f: any) => f.name === UNIQUE_FILE);
        if (exists1) {
            await request(server).delete(`/drive/v3/files/${exists1.id}`).set('Authorization', 'Bearer valid-token');
        }

        // 2. Concurrent Create
        // Client A and Client B try to create the same file "at the same time"
        // Due to server unique constraint, one should fail with 409.

        const reqA = request(server)
            .post('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token')
            .send({ name: UNIQUE_FILE, mimeType: 'text/plain' });

        const reqB = request(server)
            .post('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token')
            .send({ name: UNIQUE_FILE, mimeType: 'text/plain' });

        const [resA, resB] = await Promise.all([reqA, reqB]);

        // One should be 200, one should be 409
        const statuses = [resA.status, resB.status].sort();
        expect(statuses).toEqual([200, 409]);

        // Verify only 1 file exists
        const check3 = await request(server)
            .get('/drive/v3/files')
            .set('Authorization', 'Bearer valid-token');
        const files = check3.body.files.filter((f: any) => f.name === UNIQUE_FILE);
        expect(files.length).toBe(1);
    });
});
