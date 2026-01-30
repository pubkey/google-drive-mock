import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { startServer } from '../src/index';
import { Server } from 'http';

describe('Google Drive Mock API', () => {
    let server: Server;

    beforeAll(() => {
        const latency = process.env.LATENCY ? parseInt(process.env.LATENCY, 10) : 0;
        server = startServer(0, 'localhost', { serverLagBefore: latency }); // Random port
    });

    afterAll(() => {
        server.close();
    });

    describe('GET /drive/v3/about', () => {
        it('should return about information', async () => {
            const response = await request(server)
                .get('/drive/v3/about')
                .set('Authorization', 'Bearer valid-token');
            expect(response.status).toBe(200);
            expect(response.body.kind).toBe('drive#about');
            expect(response.body.user).toBeDefined();
        });
    });

    describe('Files API', () => {
        let createdFileId: string;

        // 1. Create File
        it('POST /drive/v3/files - should create a file (Happy Path)', async () => {
            const newFile = { name: 'Test File', mimeType: 'text/plain' };
            const response = await request(server)
                .post('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token')
                .send(newFile);

            expect(response.status).toBe(200);
            expect(response.body.name).toBe(newFile.name);
            expect(response.body.id).toBeDefined();
            createdFileId = response.body.id;
        });

        it('POST /drive/v3/files - should fail without name (Negative Path)', async () => {
            const response = await request(server)
                .post('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token')
                .send({ mimeType: 'text/plain' });
            expect(response.status).toBe(400);
        });

        // 2. Get File
        it('GET /drive/v3/files/:id - should get the file (Happy Path)', async () => {
            const response = await request(server)
                .get(`/drive/v3/files/${createdFileId}`)
                .set('Authorization', 'Bearer valid-token');
            expect(response.status).toBe(200);
            expect(response.body.id).toBe(createdFileId);
        });

        it('GET /drive/v3/files/:id - should return 404 for non-existent file (Negative Path)', async () => {
            const response = await request(server)
                .get('/drive/v3/files/non-existent-id')
                .set('Authorization', 'Bearer valid-token');
            expect(response.status).toBe(404);
        });

        // 3. List Files
        it('GET /drive/v3/files - should list files (Happy Path)', async () => {
            const response = await request(server)
                .get('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token');
            expect(response.status).toBe(200);
            expect(response.body.kind).toBe('drive#fileList');
            expect(Array.isArray(response.body.files)).toBe(true);
            expect(response.body.files.length).toBeGreaterThan(0);
        });

        // 4. Update File
        it('PATCH /drive/v3/files/:id - should update the file (Happy Path)', async () => {
            const updates = { name: 'Updated Name' };
            const response = await request(server)
                .patch(`/drive/v3/files/${createdFileId}`)
                .set('Authorization', 'Bearer valid-token')
                .send(updates);
            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Updated Name');
        });

        it('PATCH /drive/v3/files/:id - should return 404 for non-existent file (Negative Path)', async () => {
            const response = await request(server)
                .patch('/drive/v3/files/non-existent-id')
                .set('Authorization', 'Bearer valid-token')
                .send({ name: 'New Name' });
            expect(response.status).toBe(404);
        });

        // 5. Delete File
        it('DELETE /drive/v3/files/:id - should delete the file (Happy Path)', async () => {
            const response = await request(server)
                .delete(`/drive/v3/files/${createdFileId}`)
                .set('Authorization', 'Bearer valid-token');
            expect(response.status).toBe(204);
        });

        it('DELETE /drive/v3/files/:id - should return 404 if file already deleted (Negative Path)', async () => {
            const response = await request(server)
                .delete(`/drive/v3/files/${createdFileId}`)
                .set('Authorization', 'Bearer valid-token');
            expect(response.status).toBe(404);
        });

        // 6. ETag Support
        it('GET /drive/v3/files/:id - should support ETag caching', async () => {
            // Create a new file for ETag testing
            const newFile = { name: 'ETag Test File', mimeType: 'text/plain' };
            const createRes = await request(server)
                .post('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token')
                .send(newFile);
            const fileId = createRes.body.id;

            // First request to get the ETag
            const response1 = await request(server)
                .get(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token');
            expect(response1.status).toBe(200);
            const etag = response1.headers['etag'];
            expect(etag).toBeDefined();

            // Second request with If-None-Match
            const response2 = await request(server)
                .get(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .set('If-None-Match', etag);
            expect(response2.status).toBe(304);

            // Update file (changes version/ETag)
            await request(server)
                .patch(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .send({ name: 'Changed Again' });

            // Request with old ETag should now return 200
            const response3 = await request(server)
                .get(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .set('If-None-Match', etag);
            expect(response3.status).toBe(200);
            expect(response3.headers['etag']).not.toBe(etag);
        });

        // 7. If-Match Support
        it('PATCH /drive/v3/files/:id - should fail with 412 if ETag does not match', async () => {
            // Create file
            const createRes = await request(server)
                .post('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token')
                .send({ name: 'If-Match Test' });
            const fileId = createRes.body.id;

            // Get ETag
            const getRes = await request(server)
                .get(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token');
            const etag = getRes.headers['etag'];

            // Update with correct ETag (Happy Path)
            const updateRes = await request(server)
                .patch(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .set('If-Match', etag)
                .send({ name: 'Updated Name' });
            expect(updateRes.status).toBe(200);

            // Update with OLD ETag (should fail)
            const failRes = await request(server)
                .patch(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .set('If-Match', etag) // This is now old
                .send({ name: 'Should Not Update' });
            expect(failRes.status).toBe(412);
        });

        it('DELETE /drive/v3/files/:id - should fail with 412 if ETag does not match', async () => {
            // Create file
            const createRes = await request(server)
                .post('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token')
                .send({ name: 'If-Match Delete Test' });
            const fileId = createRes.body.id;

            // Get ETag
            const getRes = await request(server)
                .get(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token');
            const etag = getRes.headers['etag'];

            // Try delete with wrong ETag
            const failRes = await request(server)
                .delete(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .set('If-Match', '"wrong-etag"');
            expect(failRes.status).toBe(412);

            // Delete with correct ETag
            const successRes = await request(server)
                .delete(`/drive/v3/files/${fileId}`)
                .set('Authorization', 'Bearer valid-token')
                .set('If-Match', etag);
            expect(successRes.status).toBe(204);
        });

        // 8. Auth Support
        it('should return 401 if no token provided', async () => {
            const response = await request(server).get('/drive/v3/about');
            expect(response.status).toBe(401);
        });

        it('should return 401 if invalid token provided', async () => {
            const response = await request(server)
                .get('/drive/v3/about')
                .set('Authorization', 'Bearer invalid-token');
            expect(response.status).toBe(401);
        });
    });

    describe('Batch API', () => {
        it('POST /batch - should handle multiple requests', async () => {
            const boundary = 'batch_foobar';
            const body =
                `--${boundary}
Content-Type: application/http
Content-ID: 1

POST /drive/v3/files HTTP/1.1

{
 "name": "Batch File 1"
}

--${boundary}
Content-Type: application/http
Content-ID: 2

POST /drive/v3/files HTTP/1.1

{
 "name": "Batch File 2"
}

--${boundary}--`;

            const response = await request(server)
                .post('/batch')
                .set('Content-Type', `multipart/mixed; boundary=${boundary}`)
                .set('Authorization', 'Bearer valid-token')
                .parse((res, callback) => {
                    let data = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => { callback(null, data); });
                })
                .send(body);

            const responseText = response.body;


            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('multipart/mixed');
            expect(responseText).toContain('Batch File 1');
            expect(responseText).toContain('Batch File 2');
            expect(responseText).toContain('HTTP/1.1 200 OK');
        });

        it('POST /batch - should parse GET requests', async () => {
            // First create a file
            const newFile = { name: 'Get Batch File', mimeType: 'text/plain' };
            const createRes = await request(server)
                .post('/drive/v3/files')
                .set('Authorization', 'Bearer valid-token')
                .send(newFile);
            const fileId = createRes.body.id;

            const boundary = 'batch_get';
            const body =
                `--${boundary}
Content-Type: application/http
Content-ID: 1

GET /drive/v3/files/${fileId} HTTP/1.1

--${boundary}--`;

            const response = await request(server)
                .post('/batch')
                .set('Content-Type', `multipart/mixed; boundary=${boundary}`)
                .set('Authorization', 'Bearer valid-token')
                .parse((res, callback) => {
                    let data = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => { callback(null, data); });
                })
                .send(body);

            expect(response.status).toBe(200);
            expect(response.body).toContain(fileId);
            expect(response.body).toContain('Get Batch File');
        });
    });
});
