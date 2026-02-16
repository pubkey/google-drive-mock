
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';
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

        // Capture headers as an array of [key, value] to preserve order if possible (though Headers object iteration order is not guaranteed to match wire order in all environments, it's worth checking)
        const headerList: [string, string][] = [];
        res.headers.forEach((val, key) => headerList.push([key, val]));

        const resText = await res.text();

        return { status: res.status, headers: headerList, body: resText, rawHeaders: res.headers };
    } else {
        const addr = target.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const baseUrl = `http://localhost:${port}`;
        return makeRequest(baseUrl, method, path, headers, body);
    }
}

describe('Parity: Media Download Order', () => {
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



    it('should return data in the same order and format', async () => {
        // 1. Create a file with specific content (Pretty printed JSON)
        const fileContent = '{\n  "b": 1,\n  "a": 2\n}';
        const createRes = await req('POST', '/drive/v3/files', {
            name: 'Order Test File',
            mimeType: 'application/json'
        });
        expect(createRes.status).toBe(200);
        const fileId = JSON.parse(createRes.body).id;

        // Upload content
        const updateRes = await req('PATCH', `/upload/drive/v3/files/${fileId}?uploadType=media`, fileContent, {
            'Content-Type': 'application/json'
        });
        expect(updateRes.status).toBe(200);

        // 2. Download with alt=media
        const downloadUrl = `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
        const res = await req('GET', downloadUrl);

        console.log('--- Response Headers ---');
        console.log(JSON.stringify(res.headers, null, 2));
        console.log('--- Response Body ---');
        console.log(res.body);

        expect(res.status).toBe(200);
        expect(res.body).toBe(fileContent);

        // Clean up
        await req('DELETE', `/drive/v3/files/${fileId}`);
    });

});
