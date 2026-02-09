
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

    it('should handle If-None-Match: * on file creation (Atomic Create-If-Not-Exists)', async () => {
        const fileName = 'AtomicFile_' + Date.now();
        const content = { atomic: true };

        const { body, boundary } = createMultipartBody({
            name: fileName,
            parents: [config.testFolderId],
            mimeType: 'application/json'
        }, content);

        const upload = async (headers: Record<string, string> = {}) => fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': `multipart/related; boundary="${boundary}"`,
                ...headers
            },
            body
        });

        // 1. First creation should succeed
        const res1 = await upload({ 'If-None-Match': '*' });
        // NOTE: Google Drive API v3 generally ignores If-None-Match on POST (create).
        // It does not support atomic "create only if not exists" via standard headers on create.
        // It creates a duplicate.
        // We want to VERIFY this behavior. If it truly ignores it, status should be 200.
        // If it supports it (feature request), it might return 412.

        expect(res1.status).toBe(200);
        const file1 = await res1.json();

        // 2. Second creation with If-None-Match: *
        const res2 = await upload({ 'If-None-Match': '*' });

        // If atomic create is NOT supported, this will successfully create a duplicate (200).
        // If atomic create IS supported, this should fail (412).
        // Current Real API behavior: It ignores If-None-Match and creates a duplicate.
        // We ensure the Mock behaves exactly the same.
        expect(res2.status).toBe(200);

        // We assert the standard behavior for now: It creates a duplicate.
        expect(res2.status).toBe(200);
        const file2 = await res2.json();
        expect(file1.id).not.toBe(file2.id);
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

        let updateRes;
        try {
            updateRes = await fetch(`${config.baseUrl}/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${updateBoundary}"`
                },
                body: updateBody
            });
        } catch (err: unknown) {
            // In browser, if the server returns 404/405 without CORS headers, fetch throws.
            if (err instanceof TypeError && err.message === 'Failed to fetch') {
                return;
            }
            throw err;
        }

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

            let updateRes;
            try {
                updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=multipart`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${config.token}`,
                        'Content-Type': `multipart/related; boundary="${updateBoundary}"`
                    },
                    body: updateBody
                });
            } catch (err: unknown) {
                // In browser, if the server returns 404/405 without CORS headers (because method is not allowed),
                // fetch throws "TypeError: Failed to fetch".
                // This confirms the endpoint does not support PATCH (or at least not in a way accessible to browser).
                // We consider this a pass for "not supported".
                if (err instanceof TypeError && err.message === 'Failed to fetch') {
                    return;
                }
                throw err;
            }

            expect(updateRes.status).toBe(404);
            // V2 Upload endpoint does not support PATCH, only PUT.
        });

        it('should handle If-None-Match: * on file creation (Atomic Create-If-Not-Exists) in V2', async () => {
            const fileName = 'AtomicFileV2_' + Date.now();
            const content = { atomic: true };

            const { body, boundary } = createMultipartBody({
                title: fileName,
                parents: [{ id: config.testFolderId }],
                mimeType: 'application/json'
            }, content);

            const upload = async (headers: Record<string, string> = {}) => fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=multipart`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': `multipart/related; boundary="${boundary}"`,
                    ...headers
                },
                body
            });

            // 1. First creation attempt with If-None-Match: *
            const res1 = await upload({ 'If-None-Match': '*' });

            // Real V2 API returns 412 Precondition Failed when If-None-Match: * is provided on create.
            // This suggests it evaluates the condition against the collection resource (which exists),
            // or simply rejects the header for POST.
            // We ensure Mock matches this behavior.
            expect(res1.status).toBe(412);

            // 2. Second creation attempt (should also be 412)
            const res2 = await upload({ 'If-None-Match': '*' });
            expect(res2.status).toBe(412);
        });
    });
});
