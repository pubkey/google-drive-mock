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

describe('Google Drive API V2 Basics', () => {
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

    it('should create a file with V2 fields (title vs name)', async () => {
        const createRes = await req('POST', '/drive/v2/files', {
            title: 'V2 Created File',
            mimeType: 'text/plain'
        });
        expect(createRes.status).toBe(200);
        expect(createRes.body.title).toBe('V2 Created File');
        expect(createRes.body.kind).toBe('drive#file');
        expect(createRes.body.id).toBeTruthy();

        const fileId = createRes.body.id;

        // Verify with GET
        const getRes = await req('GET', `/drive/v2/files/${fileId}`);
        expect(getRes.status).toBe(200);
        expect(getRes.body.title).toBe('V2 Created File');
    });

    it('should update a file using PUT', async () => {
        // Create
        const createRes = await req('POST', '/drive/v2/files', { title: 'To Update' });
        const fileId = createRes.body.id;

        // Update
        const updateRes = await req('PUT', `/drive/v2/files/${fileId}`, {
            title: 'Updated via PUT'
        });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.title).toBe('Updated via PUT');
    });

    it('should patch a file using PATCH', async () => {
        // Create
        const createRes = await req('POST', '/drive/v2/files', { title: 'To Patch' });
        const fileId = createRes.body.id;

        // Patch
        const patchRes = await req('PATCH', `/drive/v2/files/${fileId}`, {
            title: 'Patched Title'
        });
        expect(patchRes.status).toBe(200);
        expect(patchRes.body.title).toBe('Patched Title');
    });

    it('should delete a file', async () => {
        // Create
        const createRes = await req('POST', '/drive/v2/files', { title: 'To Delete' });
        const fileId = createRes.body.id;

        // Delete
        const deleteRes = await req('DELETE', `/drive/v2/files/${fileId}`);
        expect(deleteRes.status).toBe(204);

        // Verify Gone
        const getRes = await req('GET', `/drive/v2/files/${fileId}`);
        expect(getRes.status).toBe(404);
    });

    it('should handle V2 parent references correctly', async () => {
        const parentRes = await req('POST', '/drive/v2/files', {
            title: 'V2 Parent Folder',
            mimeType: 'application/vnd.google-apps.folder'
        });
        const parentId = parentRes.body.id;

        const childRes = await req('POST', '/drive/v2/files', {
            title: 'V2 Child File',
            parents: [{ id: parentId }]
        });

        expect(childRes.status).toBe(200);
        expect(Array.isArray(childRes.body.parents)).toBe(true);
        expect(childRes.body.parents[0].id).toBe(parentId);
        expect(childRes.body.parents[0].kind).toBe('drive#parentReference');
    });
});
