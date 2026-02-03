import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';
import { Server } from 'http';

// Helper to handle both Server (Node) and URL (Browser)
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

        const resBody = res.headers.get('content-type')?.includes('application/json')
            ? await res.json()
            : await res.text();

        return { status: res.status, body: resBody, headers: res.headers };
    } else {
        const addr = target.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const baseUrl = `http://localhost:${port}`;

        return makeRequest(baseUrl, method, path, headers, body);
    }
}

describe('ETag and If-Match Support', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    async function req(method: string, path: string, body?: unknown, customHeaders: Record<string, string> = {}) {
        const headers = {
            'Authorization': `Bearer ${config.token}`,
            ...customHeaders
        };
        return makeRequest(config.target, method, path, headers, body);
    }

    it('should NOT return ETag header when getting a file (Parity with Real API)', async () => {
        // Create file
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'ETag Test File',
            mimeType: 'text/plain',
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        // Get file
        const getRes = await req('GET', `/drive/v3/files/${fileId}?fields=*`);

        expect(getRes.status).toBe(200);
        // Real API v3 does not return 'etag' header in this context.
        expect(getRes.headers.get('etag')).toBeFalsy();
    });

    it('should ignore If-Match (return 200) even if valid (Parity with Real API)', async () => {
        // Create file
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'If-Match Success File',
            parents: [config.testFolderId]
        });
        const fileId = createRes.body.id;

        // Even if we send a "valid" hypothetical etag, it should pass (200)
        // because Real API allows overwrites and seems to ignore If-Match if no ETag is present/supported.
        const updateRes = await req('PATCH', `/drive/v3/files/${fileId}`, {
            name: 'Updated Name'
        }, {
            'If-Match': '"1"'
        });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.name).toBe('Updated Name');
    });

    it('should ignore If-Match (return 200) if If-Match does not match (Parity with Real API)', async () => {
        // Create file
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'If-Match Fail File',
            parents: [config.testFolderId]
        });
        const fileId = createRes.body.id;

        // Update with incorrect If-Match
        const updateRes = await req('PATCH', `/drive/v3/files/${fileId}`, {
            name: 'Should Update Anyway'
        }, {
            'If-Match': '"invalid-tag"'
        });

        // Real API returns 200 (Last Write Wins)
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.name).toBe('Should Update Anyway');
    });

    it('should allow PATCH if If-Match is * (Wildcard)', async () => {
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'Wildcard File',
            parents: [config.testFolderId]
        });
        const fileId = createRes.body.id;

        const updateRes = await req('PATCH', `/drive/v3/files/${fileId}`, {
            name: 'Wildcard Updated'
        }, {
            'If-Match': '*'
        });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.name).toBe('Wildcard Updated');
    });

    it('should allow DELETE if If-Match matches (Parity)', async () => {
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'Delete Success File',
            parents: [config.testFolderId]
        });
        const fileId = createRes.body.id;

        const deleteRes = await req('DELETE', `/drive/v3/files/${fileId}`, undefined, {
            'If-Match': '"1"'
        });

        expect(deleteRes.status).toBe(204);
        const verifyRes = await req('GET', `/drive/v3/files/${fileId}`);
        expect(verifyRes.status).toBe(404);
    });

    it('should allow DELETE (204) if If-Match does not match (Parity)', async () => {
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'Delete Fail File',
            parents: [config.testFolderId]
        });
        const fileId = createRes.body.id;

        const deleteRes = await req('DELETE', `/drive/v3/files/${fileId}`, undefined, {
            'If-Match': '"wrong-tag"'
        });

        // Real API returns 204 (Delete succeeded despite If-Match header)
        expect(deleteRes.status).toBe(204);

        const verifyRes = await req('GET', `/drive/v3/files/${fileId}`);
        expect(verifyRes.status).toBe(404);
    });
});
