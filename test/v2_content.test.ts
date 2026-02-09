import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('V2 Content Updates', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should create a file with content', async () => {
        const content = 'Initial Content';
        const res = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: content
        });
        expect(res.status).toBe(200);
        const file = await res.json();

        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(await contentRes.text()).toBe(content);
    });

    it('should overwrite file with new content', async () => {
        // 1. Create file
        const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'Old Content'
        });
        const file = await createRes.json();

        // 2. Update content
        const newContent = 'New Updated Content';
        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${file.id}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: newContent
        });
        expect(updateRes.status).toBe(200);

        // 3. Verify
        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(await contentRes.text()).toBe(newContent);
    });

    it('should overwrite file with empty string', async () => {
        const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'Non-Empty Content'
        });
        const file = await createRes.json();

        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${file.id}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: ''
        });
        expect(updateRes.status).toBe(200);

        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        // Real API might return empty string or 204 No Content for empty bod, checking text() to be empty
        const text = await contentRes.text();
        expect(text).toBe('');
    });

    it('should create a JSON file and overwrite with empty string', async () => {
        const jsonContent = JSON.stringify({ key: 'value', foo: 'bar' });
        const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: jsonContent
        });
        expect(createRes.status).toBe(200);
        const file = await createRes.json();

        // Verify initial content
        const initialContentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(await initialContentRes.json()).toEqual(JSON.parse(jsonContent));

        // Overwrite with empty string
        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${file.id}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json' // Keeping type as json even if empty
            },
            body: ''
        });
        expect(updateRes.status).toBe(200);

        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        const text = await contentRes.text();
        expect(text).toBe('');
    });

    it('should update file with correct ETag (If-Match)', async () => {
        const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'ETag Test Content'
        });
        const file = await createRes.json();

        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${file.id}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain',
                'If-Match': file.etag
            },
            body: 'Updated with ETag'
        });
        expect(updateRes.status).toBe(200);

        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(await contentRes.text()).toBe('Updated with ETag');
    }, 10000);

    it('should fail to update file with incorrect ETag', async () => {
        const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'ETag Fail Test'
        });
        const file = await createRes.json();

        // Try a drastically different ETag that definitely shouldn't match
        const invalidEtag = '"0"';

        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${file.id}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain',
                'If-Match': invalidEtag
            },
            body: 'Should Not Update'
        });
        expect(updateRes.status).toBe(412);
    }, 10000);
});
