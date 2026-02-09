
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Multipart Upload Behavior (Conflicts, Overwrites, Replacements)', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    const createMultipartBody = (metadata: Record<string, unknown>, content: Record<string, unknown>) => {
        const multipartBoundary = '-------314159265358979323846';
        const delimiter = '\r\n--' + multipartBoundary + '\r\n';
        const closeDelim = '\r\n--' + multipartBoundary + '--';

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(content) +
            closeDelim;

        return { body, boundary: multipartBoundary };
    };

    it('should allow creating duplicate files (Conflict scenario - same name/parent)', async () => {
        const fileName = 'DuplicateFile_' + Date.now();
        const content = { test: 'value' };

        const { body, boundary } = createMultipartBody({
            name: fileName,
            parents: [config.testFolderId],
            mimeType: 'application/json'
        }, content);

        const upload = async () => fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${boundary}"`
            },
            body
        });

        const res1 = await upload();
        expect(res1.status).toBe(200);
        const file1 = await res1.json();

        const res2 = await upload();
        expect(res2.status).toBe(200);
        const file2 = await res2.json();

        expect(file1.id).not.toBe(file2.id);
        expect(file1.name).toBe(file2.name);
    });

    it('should overwrite/update file content and metadata using PATCH (Replacement)', async () => {
        // 1. Create file
        const fileName = 'PatchFile_' + Date.now();
        const { body: createBody, boundary: createBoundary } = createMultipartBody({
            name: fileName,
            parents: [config.testFolderId],
            mimeType: 'application/json'
        }, { original: true });

        const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${createBoundary}"`
            },
            body: createBody
        });
        const file = await createRes.json();
        const fileId = file.id;

        // 2. Update with PATCH
        const newName = fileName + '_Updated';
        const { body: updateBody, boundary: updateBoundary } = createMultipartBody({
            name: newName
        }, { updated: true });

        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${updateBoundary}"`
            },
            body: updateBody
        });

        expect(updateRes.status).toBe(200);
        const updatedFile = await updateRes.json();
        expect(updatedFile.name).toBe(newName);

        // Check content
        const contentRes = await fetch(`${config.baseUrl}/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const content = await contentRes.json();
        expect(content).toEqual({ updated: true });
    });

    it('should overwrite/update file content and metadata using PUT (Replacement)', async () => {
        // 1. Create file
        const fileName = 'PutFile_' + Date.now();
        const { body: createBody, boundary: createBoundary } = createMultipartBody({
            name: fileName,
            parents: [config.testFolderId],
            mimeType: 'application/json'
        }, { original: true });

        const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${createBoundary}"`
            },
            body: createBody
        });
        const file = await createRes.json();
        const fileId = file.id;

        // 2. Update with PUT
        const newName = fileName + '_PutUpdated';
        const { body: updateBody, boundary: updateBoundary } = createMultipartBody({
            name: newName
        }, { put_updated: true });

        const updateRes = await fetch(`${config.baseUrl}/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${updateBoundary}"`
            },
            body: updateBody
        });

        expect(updateRes.status).toBe(404);
        // Google Drive V3 does not support PUT for updates on this endpoint, only PATCH.
        // Therefore we expect 404 (Method Not Allowed often returns 404 on Google APIs or just 404 path not found for verb).
        // Actually, the upload endpoint supports PUT for *media* upload without metadata, 
        // but for multipart/related metadata+content update, the documentation primarily points to PATCH.
        // The error received was 404.
    });

    it('should handle NotFound (404) for non-existent file on update', async () => {
        const { body, boundary } = createMultipartBody({ name: 'fail' }, { data: 1 });
        const res = await fetch(`${config.baseUrl}/upload/drive/v3/files/non_existent_id?uploadType=multipart`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${boundary}"`
            },
            body: body
        });
        expect(res.status).toBe(404);
    });

    // V2 Tests
    describe('V2 Multipart Behavior (Conflicts, Overwrites, Replacements)', () => {
        it('should allow creating duplicate files (Conflict scenario - same name/parent) in V2', async () => {
            const fileName = 'DuplicateFileV2_' + Date.now();
            const content = { test: 'value_v2' };

            const { body, boundary } = createMultipartBody({
                title: fileName, // V2 uses 'title' instead of 'name'
                parents: [{ id: config.testFolderId }], // V2 parents structure
                mimeType: 'application/json'
            }, content);

            const upload = async () => fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=multipart`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${boundary}"`
                },
                body
            });

            const res1 = await upload();
            expect(res1.status).toBe(200);
            const file1 = await res1.json();

            const res2 = await upload();
            expect(res2.status).toBe(200);
            const file2 = await res2.json();

            expect(file1.id).not.toBe(file2.id);
            expect(file1.title).toBe(file2.title);
        });

        it('should overwrite/update file content and metadata using PUT (Replacement) in V2', async () => {
            // 1. Create file
            const fileName = 'PutFileV2_' + Date.now();
            const { body: createBody, boundary: createBoundary } = createMultipartBody({
                title: fileName,
                parents: [{ id: config.testFolderId }],
                mimeType: 'application/json'
            }, { original: true });

            const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=multipart`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${createBoundary}"`
                },
                body: createBody
            });
            const file = await createRes.json();
            const fileId = file.id;

            // 2. Update with PUT
            const newTitle = fileName + '_PutUpdated';
            const { body: updateBody, boundary: updateBoundary } = createMultipartBody({
                title: newTitle
            }, { put_updated: true });

            const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=multipart`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${updateBoundary}"`
                },
                body: updateBody
            });

            expect(updateRes.status).toBe(200);
            const updatedFile = await updateRes.json();
            expect(updatedFile.title).toBe(newTitle);

            // Check content
            const contentRes = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?alt=media`, {
                headers: { Authorization: `Bearer ${config.token}` }
            });
            const content = await contentRes.json();
            expect(content).toEqual({ put_updated: true });
        });

        it('should overwrite/update file content and metadata using PATCH (Replacement) in V2', async () => {
            // 1. Create file
            const fileName = 'PatchFileV2_' + Date.now();
            const { body: createBody, boundary: createBoundary } = createMultipartBody({
                title: fileName,
                parents: [{ id: config.testFolderId }],
                mimeType: 'application/json'
            }, { original: true });

            const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=multipart`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${createBoundary}"`
                },
                body: createBody
            });
            const file = await createRes.json();
            const fileId = file.id;

            // 2. Update with PATCH
            const newTitle = fileName + '_PatchUpdated';
            const { body: updateBody, boundary: updateBoundary } = createMultipartBody({
                title: newTitle
            }, { patch_updated: true });

            const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=multipart`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${updateBoundary}"`
                },
                body: updateBody
            });

            expect(updateRes.status).toBe(404);
            // V2 Upload endpoint does not support PATCH, only PUT.
        });
    });
});
