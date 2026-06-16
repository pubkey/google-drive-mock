import { describe, expect, beforeAll, afterAll } from 'vitest';
import { it } from './config';;
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

describe('Google Drive API V3 Parity', () => {
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

    it('should return 400 if fields=etag is requested on get', async () => {
        // Create file
        const name = `V3 Fields Test ${Math.random().toString(36).substring(7)}`;
        const createRes = await req('POST', '/drive/v3/files', { name });
        const fileId = createRes.body.id;

        try {
            // Request with fields=etag
            const getRes = await req('GET', `/drive/v3/files/${fileId}?fields=etag,name`);
            expect(getRes.status).toBe(400);
        } finally {
            await req('DELETE', `/drive/v3/files/${fileId}`);
        }
    });

    it('should return 400 if fields=etag is requested on list', async () => {
        const getRes = await req('GET', `/drive/v3/files?fields=files(id,name,mimeType,parents,modifiedTime,size,etag)`);
        expect(getRes.status).toBe(400);
    });

    it('should ignore If-Match header on PATCH (Last Write Wins)', async () => {
        // Create file
        const name = `V3 If-Match Test ${Math.random().toString(36).substring(7)}`;
        const createRes = await req('POST', '/drive/v3/files', { name });
        const fileId = createRes.body.id;

        try {
            // Update with Wrong ETag
            const updateRes = await req('PATCH', `/drive/v3/files/${fileId}`, {
                name: 'Updated Name V3'
            }, {
                'If-Match': '"wrong-etag"'
            });

            // Should Succeed (200) and Update
            expect(updateRes.status).toBe(200);
            expect(updateRes.body.name).toBe('Updated Name V3');

            // Verify update persisted
            const getRes = await req('GET', `/drive/v3/files/${fileId}`);
            expect(getRes.body.name).toBe('Updated Name V3');
        } finally {
            await req('DELETE', `/drive/v3/files/${fileId}`);
        }
    });

    it('should allow fetching ETag from V2 and using it for If-Match content updates (RxDB replication flow)', async () => {
        // 1. Create file via POST
        const name = `V3 ETag Header Test ${Math.random().toString(36).substring(7)}`;
        const createRes = await req('POST', '/drive/v3/files', { name });
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        try {
            // 2. Fetch the file via V2 GET to obtain the ETag
            const v2Res = await req('GET', `/drive/v2/files/${fileId}`);
            expect(v2Res.status).toBe(200);
            const etag = v2Res.body.etag;
            expect(etag).toBeDefined();
            expect(etag).toBeTruthy();

            // 3. Update via V3 PATCH upload with If-Match: etag (representing RxDB's V3 updates with V2-obtained ETag)
            const updateRes = await req('PATCH', `/upload/drive/v3/files/${fileId}?uploadType=media`, 'v3 content', {
                'Content-Type': 'text/plain',
                'If-Match': etag
            });
            expect(updateRes.status).toBe(200);
        } finally {
            // Clean up: delete file
            await req('DELETE', `/drive/v3/files/${fileId}`);
        }
    });
});
