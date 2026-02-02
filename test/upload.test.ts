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
    it('should allow creating files with the same name in different folders (multipart)', async () => {
        // 1. Create Parent A
        const parentResA = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'FolderA_' + Date.now(),
                mimeType: 'application/vnd.google-apps.folder',
                parents: [config.testFolderId]
            })
        });
        const parentIdA = (await parentResA.json()).id;

        // 2. Create Parent B
        const parentResB = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'FolderB_' + Date.now(),
                mimeType: 'application/vnd.google-apps.folder',
                parents: [config.testFolderId]
            })
        });
        const parentIdB = (await parentResB.json()).id;

        const commonFileName = 'DuplicateName.json';
        const content = { foo: 'bar' };

        // Helper to do multipart upload
        const uploadFile = async (parentId: string) => {
            const metadata = {
                name: commonFileName,
                parents: [parentId],
                mimeType: 'application/json'
            };

            const multipartBoundary = '-------UniqueBoundary' + Date.now();
            const delimiter = '\r\n--' + multipartBoundary + '\r\n';
            const closeDelim = '\r\n--' + multipartBoundary + '--';

            const body = delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(content) +
                closeDelim;

            const url = `${config.baseUrl}/upload/drive/v3/files?uploadType=multipart&fields=id`;
            return fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + config.token,
                    'Content-Type': 'multipart/related; boundary="' + multipartBoundary + '"'
                },
                body
            });
        };

        // 3. Upload to Folder A
        const resA = await uploadFile(parentIdA);
        expect(resA.status).toBe(200);
        const fileA = await resA.json();

        // 4. Upload to Folder B (Should succeed)
        const resB = await uploadFile(parentIdB);

        if (!resB.ok) {
            console.log('Duplicate upload failed:', resB.status, await resB.text());
        }
        expect(resB.status).toBe(200);
        const fileB = await resB.json();

        // IDs must be different
        expect(fileA.id).not.toBe(fileB.id);
    });
});
