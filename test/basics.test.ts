import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

// Helper to handle both Server (Node) and URL (Browser)
async function makeRequest(
    target: any,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: any
) {
    if (typeof target === 'string') {
        const url = `${target}${path}`;
        const fetchOptions: RequestInit = {
            method: method,
            headers: headers
        };
        if (body) {
            if (typeof body === 'string') {
                fetchOptions.body = body;
            } else {
                fetchOptions.body = JSON.stringify(body);
                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }
        }

        const res = await fetch(url, fetchOptions);

        // Return object strictly compatible with tests
        const resBody = res.headers.get('content-type')?.includes('application/json')
            ? await res.json()
            : await res.text(); // or handle multipart manual parsing?

        // For multipart, res.text() is what we want.

        return {
            status: res.status,
            body: resBody,
            // Mock supertest .text prop if needed, but we check body casted usually.
            // If body is JSON, resBody is object.
            // If text, resBody is string.
        };
    } else {
        // Node: Use supertest (Wait! We wanted to REMOVE supertest for browser compat?)
        // If we import supertest here statically, it breaks browser.
        // We should use fetch in Node too?
        // Node 24 has native fetch.
        // But `target` is a `Server` instance (http.Server).
        // Native fetch needs a URL.
        // If target is Server, we need its address.

        const addr = target.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const baseUrl = `http://localhost:${port}`;

        return makeRequest(baseUrl, method, path, headers, body);
    }
}

describe('Google Drive Mock API', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        config.stop();
    });

    async function req(method: string, path: string, body?: any, customHeaders: Record<string, string> = {}) {
        const headers = {
            'Authorization': `Bearer ${config.token}`,
            ...customHeaders
        };
        return makeRequest(config.target, method, path, headers, body);
    }

    describe('GET /drive/v3/about', () => {
        it('should return about information', async () => {
            const response = await req('GET', '/drive/v3/about?fields=kind,user');
            expect(response.status).toBe(200);
            expect(response.body.kind).toBe('drive#about');
            expect(response.body.user).toBeDefined();
            console.log(`Connected as: ${response.body.user.displayName} <${response.body.user.emailAddress}>`);
        });
    });

    describe('Files API', () => {
        let createdFileId: string;

        // 1. Create File
        it('POST /drive/v3/files - should create a file (Happy Path)', async () => {
            const newFile = { name: 'Test File', mimeType: 'text/plain' };
            const response = await req('POST', '/drive/v3/files', newFile);

            expect(response.status).toBe(200);
            expect(response.body.name).toBe(newFile.name);
            expect(response.body.id).toBeDefined();
            createdFileId = response.body.id;
        });

        it('POST /drive/v3/files - should fail without name (Negative Path)', async () => {
            if (!config.isMock) return;

            const response = await req('POST', '/drive/v3/files', { mimeType: 'text/plain' });
            expect(response.status).toBe(400);
        });

        // 2. Get File
        it('GET /drive/v3/files/:id - should get file', async () => {
            // Need to verify createdFileId exists (if previous test failed, this might fail or throw)
            if (!createdFileId) return; // Skip

            const response = await req('GET', `/drive/v3/files/${createdFileId}`);

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(createdFileId);
            expect(response.body.name).toBe('Test File');
        });

        // 3. Update File
        it('PATCH /drive/v3/files/:id - should update file', async () => {
            if (!createdFileId) return;

            const response = await req('PATCH', `/drive/v3/files/${createdFileId}`, { name: 'Updated Name' });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Updated Name');
        });

        // 4. Delete File
        it('DELETE /drive/v3/files/:id - should delete file', async () => {
            if (!createdFileId) return;
            const response = await req('DELETE', `/drive/v3/files/${createdFileId}`);
            expect(response.status).toBe(204);
        });

        // 5. Verify Deletion
        it('GET /drive/v3/files/:id - should return 404 after delete', async () => {
            if (!createdFileId) return;
            const response = await req('GET', `/drive/v3/files/${createdFileId}`);
            expect(response.status).toBe(404);
        });
    });

    describe('Batch API', () => {
        it('POST /batch - should handle multiple requests', async () => {
            const boundary = 'batch_foobar';
            const body = `
--${boundary}
Content-Type: application/http
Content-ID: <item1>

GET /drive/v3/files?pageSize=1 HTTP/1.1
Authorization: Bearer ${config.token}

--${boundary}
Content-Type: application/http
Content-ID: <item2>

GET /drive/v3/about?fields=user HTTP/1.1
Authorization: Bearer ${config.token}

--${boundary}--`;

            const batchEndpoint = config.isMock ? '/batch' : '/batch/drive/v3';

            const response = await req('POST', batchEndpoint, body, {
                'Content-Type': `multipart/mixed; boundary=${boundary}`
            });

            expect(response.status).toBe(200);
            const responseText = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
            expect(responseText).toContain('HTTP/1.1 200 OK');
        });
    });
});
