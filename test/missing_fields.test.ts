import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Missing Fields Support (Size & MD5)', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should return size and md5Checksum in V3 GET', async () => {
        const content = JSON.stringify({ foo: 'bar' });
        const metadata = { name: 'V3 Size Test', mimeType: 'application/json' };

        const boundary = 'foo_bar_baz';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelim = `\r\n--${boundary}--`;

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            content +
            closeDelim;

        const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${boundary}"`
            },
            body: body
        });

        expect(createRes.status).toBe(200);
        const file = await createRes.json();

        const fields = 'id,name,size,md5Checksum';
        const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=${fields}`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(getRes.status).toBe(200);
        const getFile = await getRes.json();

        expect(getFile.size).toBeDefined();
        // size should be string in V3
        expect(String(getFile.size)).toBe(String(content.length));
        expect(getFile.md5Checksum).toBeDefined();
    });

    it('should return fileSize and md5Checksum in V2 GET', async () => {
        const content = 'V2 Content';

        // Use simple upload for V2 to ensure content and metadata
        const uploadRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: content
        });
        expect(uploadRes.status).toBe(200);
        const file = await uploadRes.json();

        expect(file.fileSize).toBeDefined(); // V2 uses fileSize
        expect(Number(file.fileSize)).toBe(content.length);
        expect(file.md5Checksum).toBeDefined();

        // Verify GET
        const getRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        const getFile = await getRes.json();
        expect(getFile.fileSize).toBeDefined();
        expect(Number(getFile.fileSize)).toBe(content.length);
        expect(getFile.md5Checksum).toBeDefined();
    });

    it('should return correct size and md5Checksum for EMPTY file', async () => {
        const content = '';
        const md5Empty = 'd41d8cd98f00b204e9800998ecf8427e'; // MD5 of empty string

        // Upload empty file via V2 media upload
        const uploadRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: content
        });
        expect(uploadRes.status).toBe(200);
        const file = await uploadRes.json();

        // Check response
        expect(file.fileSize).toBeDefined();
        expect(Number(file.fileSize)).toBe(0);
        expect(file.md5Checksum).toBe(md5Empty);

        // Verify GET V2
        const getV2 = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        const v2File = await getV2.json();
        expect(Number(v2File.fileSize)).toBe(0);
        expect(v2File.md5Checksum).toBe(md5Empty);

        // Verify GET V3
        const fields = 'id,name,size,md5Checksum';
        const getV3 = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=${fields}`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        const v3File = await getV3.json();
        expect(Number(v3File.size)).toBe(0);
        expect(v3File.md5Checksum).toBe(md5Empty);
    });
});
