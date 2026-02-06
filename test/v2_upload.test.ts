import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('V2 Upload Features', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should create a file using POST /upload/drive/v2/files?uploadType=media', async () => {
        const content = 'Hello, World via Media Upload!';
        const res = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: content
        });

        if (res.status !== 200) {
            console.log('V2 Media Upload POST failed:', res.status, await res.text());
        }

        expect(res.status).toBe(200);
        const file = await res.json();
        expect(file.id).toBeDefined();

        // Verify content
        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(contentRes.status).toBe(200);
        expect(await contentRes.text()).toBe(content);
    });

    it('should update a file content using PUT /upload/drive/v2/files/:fileId?uploadType=media', async () => {
        // 1. Create a file normally first
        const createRes = await fetch(`${config.baseUrl}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Initial Title',
                mimeType: 'text/plain'
            })
        });
        expect(createRes.status).toBe(200);
        const file = await createRes.json();
        const fileId = file.id;

        // 2. Update content via uploadType=media
        const newContent = 'Updated Content via PUT Media Upload!';
        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: newContent
        });

        if (updateRes.status !== 200) {
            console.log('V2 Media Upload PUT failed:', updateRes.status, await updateRes.text());
        }

        expect(updateRes.status).toBe(200);
        const updatedFile = await updateRes.json();
        expect(updatedFile.id).toBe(fileId);

        // 3. Verify new content
        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(contentRes.status).toBe(200);
        expect(await contentRes.text()).toBe(newContent);
    });

    it('should update metadata and content using PUT /upload/drive/v2/files/:fileId?uploadType=multipart', async () => {
        // 1. Create a file
        const createRes = await fetch(`${config.baseUrl}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Original Multipart Title',
                mimeType: 'text/html'
            })
        });
        const file = await createRes.json();
        const fileId = file.id;

        // 2. Perform multipart update
        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelim = `\r\n--${boundary}--`;

        const metadata = {
            title: 'Updated Multipart Title',
            mimeType: 'text/plain'
        };
        const newContent = 'Updated Multipart Content';

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: text/plain\r\n\r\n' +
            newContent +
            closeDelim;

        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=multipart`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${boundary}"`
            },
            body: body
        });

        expect(updateRes.status).toBe(200);
        const updatedFile = await updateRes.json();

        // 3. Verify updates
        expect(updatedFile.title).toBe('Updated Multipart Title');
        expect(updatedFile.mimeType).toBe('text/plain');

        const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(await contentRes.text()).toBe(newContent);
    });
});
