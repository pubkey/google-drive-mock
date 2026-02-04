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

    it('should return ETag header when getting a file (V2 Parity)', async () => {
        // Create file using V2 endpoint
        const createRes = await req('POST', '/drive/v2/files', {
            title: 'ETag Test File V2', // V2 uses 'title', not 'name'
            mimeType: 'text/plain',
            parents: [{ id: config.testFolderId }] // V2 parents is a list of ParentReferences
        });
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        // Get file
        const getRes = await req('GET', `/drive/v2/files/${fileId}`);

        expect(getRes.status).toBe(200);
        // Verify if V2 returns ETag (User suggests it might not, but let's verify with Real API)
        // Usually V2 DOES return ETag.
        const etag = getRes.headers.get('etag');
        // console.log('V2 ETag:', etag);
        // We will assert truthy first. If Real API fails, we adjust.
        expect(etag).toBeTruthy();
    });

    it('should support If-Match on UPDATE (V2 Parity)', async () => {
        // Create file
        const createRes = await req('POST', '/drive/v2/files', {
            title: 'If-Match V2 File',
            parents: [{ id: config.testFolderId }]
        });
        const fileId = createRes.body.id;
        const etag = createRes.body.etag;

        // Update with correct ETag
        const updateRes = await req('PUT', `/drive/v2/files/${fileId}`, {
            title: 'Updated Name V2'
        }, {
            'If-Match': etag
        });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.title).toBe('Updated Name V2');

        // Update with Wrong ETag (Modified version of real ETag)
        // Note: Real API V2 sometimes returns 500 for completely malformed ETags on PUT.
        // We try to make it look valid but wrong.
        const invalidEtag = etag.replace(/.$/, '0'); // Change last char

        const updateFail = await req('PUT', `/drive/v2/files/${fileId}`, {
            title: 'Should Fail V2'
        }, {
            'If-Match': invalidEtag
        });

        // Verify V2 behavior on mismatch.
        // If V2 supports If-Match, this should be 412.
        if (updateFail.status === 500) {
            console.error('V2 Update 500 Error Body:', JSON.stringify(updateFail.body, null, 2));
        }
        expect(updateFail.status).toBe(412);

        // TODO ensure file was not updated
        const checkRes = await req('GET', `/drive/v2/files/${fileId}`);
        expect(checkRes.status).toBe(200);
        expect(checkRes.body.title).toBe('Updated Name V2'); // Should remain unchanged
        expect(checkRes.body.title).not.toBe('Should Fail V2');
    });

    it('should support If-Match on DELETE (V2 Parity)', async () => {
        const createRes = await req('POST', '/drive/v2/files', {
            title: 'Delete V2 File',
            parents: [{ id: config.testFolderId }]
        });
        const fileId = createRes.body.id;
        const etag = createRes.body.etag;

        // Delete with Wrong ETag
        const deleteFail = await req('DELETE', `/drive/v2/files/${fileId}`, undefined, {
            'If-Match': '"wrong-etag"'
        });
        expect(deleteFail.status).toBe(412);

        // Delete with Correct ETag
        const deleteSuccess = await req('DELETE', `/drive/v2/files/${fileId}`, undefined, {
            'If-Match': etag
        });
        expect(deleteSuccess.status).toBe(204);
    });
});
