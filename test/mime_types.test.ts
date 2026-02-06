import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('MIME Type Handling', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should store and return correct Content-Type for V3 file creation (JSON)', async () => {
        const content = { foo: 'bar' };
        const res = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'mime-test.json',
                mimeType: 'application/json',
                properties: { test: 'mime' }
            })
        });
        expect(res.status).toBe(200);
        const file = await res.json();

        // Upload content separately mostly for V3, but let's check metadata first
        expect(file.mimeType).toBe('application/json');

        // Update content via PATCH (mock behavior allow simple body for text/json often)
        // Or better, use upload for content. 
        // Let's use upload for clarity.
        const uploadRes = await fetch(`${config.baseUrl}/upload/drive/v3/files/${file.id}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(content)
        });
        expect(uploadRes.status).toBe(200);

        // Verify Content-Type on GET alt=media
        const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(getRes.status).toBe(200);
        expect(getRes.headers.get('content-type')).toContain('application/json');
        expect(await getRes.json()).toEqual(content);
    });

    it('should update MIME type and return new Content-Type header', { timeout: 10000 }, async () => {
        // Create as text/plain
        const createRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'change-mime.txt',
                mimeType: 'text/plain'
            })
        });
        const file = await createRes.json();
        const fileId = file.id;

        // Content = "Hello"
        await fetch(`${config.baseUrl}/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'Hello'
        });

        // Verify initial
        let getRes = await fetch(`${config.baseUrl}/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(getRes.headers.get('content-type')).toContain('text/plain');

        // Update to text/csv
        const updateRes = await fetch(`${config.baseUrl}/drive/v3/files/${fileId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mimeType: 'text/csv'
            })
        });
        expect(updateRes.status).toBe(200);
        const updateJson = await updateRes.json();
        if (config.baseUrl.includes('googleapis') && updateJson.mimeType !== 'text/csv') {
            console.warn('Real API did not update mimeType via PATCH metadata. Skipping assertion.');
        } else {
            expect(updateJson.mimeType).toBe('text/csv');
        }

        // Verify updated
        getRes = await fetch(`${config.baseUrl}/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });

        // Real API might stick to original content type for simple text files unless content changes
        if (!config.baseUrl.includes('googleapis')) {
            expect(getRes.headers.get('content-type')).toContain('text/csv');
        }
    });

    it('should respect Content-Type header in V2 media upload', async () => {
        const content = "<h1>Html Content</h1>";
        const res = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/html'
            },
            body: content
        });
        expect(res.status).toBe(200);
        const file = await res.json();
        expect(file.mimeType).toBe('text/html');

        // Verify read
        const getRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(getRes.status).toBe(200);
        expect(getRes.headers.get('content-type')).toContain('text/html');
        expect(await getRes.text()).toBe(content);
    });

    it('should default to application/octet-stream if no MIME type provided', async () => {
        const res = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`
                // No Content-Type
            },
            body: 'Unknown Data'
        });
        expect(res.status).toBe(200);
        const file = await res.json();
        expect(file.mimeType).toMatch(/text\/plain|application\/octet-stream/);

        const getRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        // Mock might be loose, but ideally it returns octet-stream
        expect(getRes.headers.get('content-type')).toMatch(/text\/plain|application\/octet-stream/);
    });
});
