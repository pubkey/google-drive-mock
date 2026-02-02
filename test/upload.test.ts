import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Multipart Upload Feature', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should create a file with json content using multipart/related', async () => {
        const parentName = 'UploadParent_' + Date.now();
        // Create parent folder normally first
        const parentRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: parentName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [config.testFolderId]
            })
        });
        expect(parentRes.status).toBe(200);
        const parentId = (await parentRes.json()).id;

        // Now perform the multipart upload
        const fileName = 'multipart-data.json';
        const jsonContent = { some: 'data', random: Math.random() };

        const metadata = {
            name: fileName,
            parents: [parentId],
            mimeType: 'application/json'
        };

        const multipartBoundary = '-------314159265358979323846';
        const delimiter = '\r\n--' + multipartBoundary + '\r\n';
        const closeDelim = '\r\n--' + multipartBoundary + '--';

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(jsonContent) +
            closeDelim;

        // Note: URL includes /upload prefix and uploadType=multipart
        const url = `${config.baseUrl}/upload/drive/v3/files?uploadType=multipart&fields=id`;

        const uploadRes = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + config.token,
                'Content-Type': 'multipart/related; boundary="' + multipartBoundary + '"'
            },
            body
        });

        // Debug output if it fails
        if (!uploadRes.ok) {
            console.log('Upload failed:', uploadRes.status, await uploadRes.text());
        }

        expect(uploadRes.status).toBe(200);
        const data = await uploadRes.json();
        expect(data.id).toBeDefined();

        // Verify content
        const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${data.id}?fields=name,parents`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(getRes.status).toBe(200);
        const file = await getRes.json();
        expect(file.name).toBe(fileName);
        expect(file.parents).toContain(parentId);

        // Verify content storage (Mock specific)
        if (config.isMock) {
            expect(file['content']).toEqual(jsonContent);
        }
    });
});
