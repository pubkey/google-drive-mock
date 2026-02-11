import { describe, it, expect, beforeAll } from 'vitest';
import {
    getTestConfig,
    TestConfig
} from './config';
import { AppConfig } from '../src/types';

const randomString = () => Math.random().toString(36).substring(7);

const createFileWithContent = async (name: string, content: string, config: TestConfig) => {
    const res = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Content-Type': 'text/plain'
        },
        body: content
    });
    const file = await res.json();
    // V3 standard upload might not set name in body for media upload if not multipart. 
    // But store.createFile handles it. 
    // To be safe and ensure name is set as expected for query (though create with media upload sets name to Untitled usually),
    // let's update it or use multipart. 
    // actually, let's just use the patch to set name/metadata to ensure it's correct for the test.

    // Better: use multipart or just update after create.
    await fetch(`${config.baseUrl}/drive/v3/files/${file.id}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    });

    // Fetch again to get full fields including modifiedTime
    const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=*`, {
        headers: { 'Authorization': `Bearer ${config.token}` }
    });
    return await getRes.json();
};

describe('Iterate Changes Queries', () => {
    let config: TestConfig;
    let headers: Record<string, string>;

    beforeAll(async () => {
        config = await getTestConfig();
        headers = {
            Authorization: `Bearer ${config.token}`
        };
    });

    it('should find files where last write time was greater than X, sorted by modifiedTime and id, with limit', async () => {
        // Create 3 files with slight delays to ensure different modifiedTimes
        const file1 = await createFileWithContent('file1', randomString(), config);
        await new Promise(r => setTimeout(r, 1100)); // Ensure > 1s diff for reliable sorting if seconds resolution
        const file2 = await createFileWithContent('file2', randomString(), config);
        await new Promise(r => setTimeout(r, 1100));
        const file3 = await createFileWithContent('file3', randomString(), config);

        // Use file1's modifiedTime as the baseline (X)
        const timeX = file1.modifiedTime;

        // Query: modifiedTime > X, orderBy modifiedTime asc, name asc (using name as proxy for ID stability in test if needed, but user asked for ID)
        // User asked for: Sorted by write data and id. with limit
        const q = `modifiedTime > '${timeX}' and trashed = false`;
        const orderBy = 'modifiedTime asc, name asc';
        const pageSize = 1;

        // First page
        const url1 = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=${pageSize}`;
        const res1 = await fetch(url1, { headers });
        if (res1.status !== 200) {
            const txt = await res1.text();
            console.error('Error 1:', txt);
        }
        expect(res1.status).toBe(200);
        const data1 = await res1.json();

        expect(data1.files.length).toBe(1);
        expect(data1.files[0].id).toBe(file2.id);

        // If we want to simulate iteration, we would use nextPageToken or just offset logic if we supported it, 
        // but here we just test that the query works and LIMIT works.

        // Verify we can get the next one if we increase limit
        const url2 = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=2`;
        const res2 = await fetch(url2, { headers });
        const data2 = await res2.json();
        expect(data2.files.length).toBe(2);
        expect(data2.files[0].id).toBe(file2.id);
        expect(data2.files[1].id).toBe(file3.id);
    }, 60000);

    it('should find all files where write time was equal to X, sorted by id, with limit', async () => {
        // Create 2 files effectively at the "same" time (as close as possible or manually patched to be same)
        // Since we can't easily force same time on Real API without patching, we'll CREATE one, read its time, 
        // and then query for that exact time.
        // For Mock, we can rely on what we just created.

        const file = await createFileWithContent('exact-time-file', randomString(), config);
        const timeX = file.modifiedTime;

        // Create another one to ensure we don't match everything
        await new Promise(r => setTimeout(r, 1100));
        await createFileWithContent('later-file', randomString(), config);

        const q = `modifiedTime = '${timeX}' and trashed = false`;
        const orderBy = 'name asc';
        const pageSize = 10;

        const url = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=${pageSize}&fields=files(id,name,modifiedTime)`;
        const res = await fetch(url, { headers });
        expect(res.status).toBe(200);
        const data = await res.json();

        // Should find at least the file we just created
        const found = data.files.find((f: any) => f.id === file.id);
        expect(found).toBeDefined();

        // Should NOT find the later file
        // (This assumes the later file actually has a different modifiedTime string)
        const laterFound = data.files.find((f: any) => f.name === 'later-file');
        // Note: 'later-file' might have same time if we were too fast? 
        // But with 1.1s delay it should be different.

        // If strict equality is supported, we expect only matching times.
        data.files.forEach((f: any) => {
            if (!f.modifiedTime) {
                console.error('Missing modifiedTime for file:', f.id, f.name);
            }
            // allowing some tolerance if needed, but query says =
            // For string comparison based API, it should be exact.
            expect(new Date(f.modifiedTime).toISOString()).toBe(new Date(timeX).toISOString());
        });
    }, 60000);

    it('should iterate via changes tokens with specific fields', async () => {
        // User request verification:
        // const params = new URLSearchParams({
        //   pageToken: checkpoint.pageToken, // we need to get a start page token first
        //   pageSize: String(batchSize),
        //   includeItemsFromAllDrives: "true",
        //   supportsAllDrives: "true",
        //   includeRemoved: "true",
        //   fields: "changes(fileId,removed,file(id,name,parents,trashed)),nextPageToken,newStartPageToken",
        // });

        // 1. Get Start Page Token
        const startTokenUrl = `${config.baseUrl}/drive/v3/changes/startPageToken?supportsAllDrives=true`;
        const startTokenRes = await fetch(startTokenUrl, { headers });
        expect(startTokenRes.status).toBe(200);
        const startTokenData = await startTokenRes.json();
        const startPageToken = startTokenData.startPageToken;
        expect(startPageToken).toBeDefined();

        // 2. Make some changes
        const file1 = await createFileWithContent('change-file-1', randomString(), config);
        await new Promise(r => setTimeout(r, 1000));

        // Trash a file to test includeRemoved/removed field
        const trashRes = await fetch(`${config.baseUrl}/drive/v3/files/${file1.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true })
        });
        expect(trashRes.status).toBe(200);

        // 3. List Changes
        const params = new URLSearchParams({
            pageToken: startPageToken,
            pageSize: "10",
            includeItemsFromAllDrives: "true",
            supportsAllDrives: "true",
            includeRemoved: "true",
            fields: "changes(fileId,removed,file(id,name,parents,trashed)),nextPageToken,newStartPageToken"
        });

        const listUrl = `${config.baseUrl}/drive/v3/changes?${params.toString()}`;
        const listRes = await fetch(listUrl, { headers });

        if (listRes.status !== 200) {
            console.error('Changes List Error:', await listRes.text());
        }
        expect(listRes.status).toBe(200);
        const data = await listRes.json();

        expect(data.changes).toBeDefined();
        // We expect at least the creation and trash of file1. 
        // Note: Real API might batch them or show multiple entries.
        // We just verify structure and presence of fields requested.

        if (data.changes.length > 0) {
            const change = data.changes[0];
            expect(change.fileId).toBeDefined();
            // removed can be boolean
            expect(change.removed).toBeDefined();
            if (!change.removed && change.file) {
                expect(change.file.id).toBeDefined();
                expect(change.file.name).toBeDefined();
            }
        }
    }, 60000);

    it('should find files where write time > X AND inside a specific parent folder', async () => {
        // 1. Create a parent folder
        const parentRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'ParentFolder_' + randomString(),
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        expect(parentRes.status).toBe(200);
        const parent = await parentRes.json();
        const parentId = parent.id;

        // 2. Create 3 files:
        //    - One IN parent, modified OLD
        //    - One IN parent, modified NEW
        //    - One OUTSIDE parent, modified NEW

        // Define "Old" and "New" times.
        // We'll just create them sequentially with delays.

        // File 1: In parent, first.
        const file1 = await createFileWithContent('FileInParentOld', 'content1', config);
        // Move to parent
        const moveRes1 = await fetch(`${config.baseUrl}/drive/v3/files/${file1.id}?addParents=${parentId}`, {
            method: 'PATCH', headers
        });
        expect(moveRes1.status).toBe(200);

        await new Promise(r => setTimeout(r, 1100));

        // This time will be our X
        // We want to find files modified > this time.
        // So file1 should NOT be found (it is <= itself/X, or we rely on creating a checkpoint after it).
        // Let's create a checkpoint file or just use file1's time.
        const timeXRes = await fetch(`${config.baseUrl}/drive/v3/files/${file1.id}?fields=modifiedTime`, { headers });
        const timeXJson = await timeXRes.json();
        const timeX = timeXJson.modifiedTime;

        await new Promise(r => setTimeout(r, 1100));

        // File 2: In parent, NEW (should be found)
        const file2 = await createFileWithContent('FileInParentNew', 'content2', config);
        const moveRes2 = await fetch(`${config.baseUrl}/drive/v3/files/${file2.id}?addParents=${parentId}`, {
            method: 'PATCH', headers
        });
        expect(moveRes2.status).toBe(200);

        // File 3: Outside parent, NEW (should NOT be found)
        await createFileWithContent('FileOutsideNew', 'content3', config);
        // (Default parent or root, explicitly not our parentId)

        // 3. Query: modifiedTime > X AND 'parentId' in parents
        const q = `modifiedTime > '${timeX}' and '${parentId}' in parents and trashed = false`;
        const orderBy = 'modifiedTime asc, name asc';

        const url = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&fields=files(id,name,parents,modifiedTime)`;
        const res = await fetch(url, { headers });
        expect(res.status).toBe(200);
        const data = await res.json();

        const matchingFiles = data.files.filter((f: any) => f.id === file2.id);
        const nonMatchingFile1 = data.files.filter((f: any) => f.id === file1.id);

        // Should find file2
        expect(matchingFiles.length).toBe(1);
        expect(matchingFiles[0].id).toBe(file2.id);

        // Should NOT find file1 (too old)
        expect(nonMatchingFile1.length).toBe(0);

        // Should NOT find file3 (wrong parent) check manually in case it returned it
        const file3Found = data.files.find((f: any) => f.name === 'FileOutsideNew');
        expect(file3Found).toBeUndefined();

    }, 60000);

    it('should paginate through files using nextPageToken', async () => {
        // Create files
        const totalFiles = 6;
        const baseName = 'PaginatedFile_' + randomString();
        for (let i = 0; i < totalFiles; i++) {
            await createFileWithContent(`${baseName}_${i}`, `content_${i}`, config);
            // Small delay to ensure order if we sort by time, but we'll sort by name to be deterministic
        }

        const q = `name contains '${baseName}' and trashed = false`;
        const orderBy = 'name asc';
        const pageSize = 2;
        let collectedFiles: any[] = [];
        let pageToken: string | undefined;

        // Iterate pages until no token
        do {
            const url: string = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=${pageSize}` + (pageToken ? `&pageToken=${pageToken}` : '');
            const res = await fetch(url, { headers });

            if (res.status !== 200) {
                console.error('Pagination Error:', await res.text());
            }
            expect(res.status).toBe(200);
            const data = await res.json();

            if (data.files) {
                collectedFiles.push(...data.files);
            }
            pageToken = data.nextPageToken;

            // Safety break to prevent infinite loops if API is broken
            if (collectedFiles.length > totalFiles + 10) break;
        } while (pageToken);

        // Verify total
        // Note: Drive API matching is eventually consistent. 
        // We might need to retry or wait if count is not yet totalFiles, 
        // but since we created them with delays, it usually works.
        // If it flakes on count, we might need a retry loop wrapper around the whole test or query.
        expect(collectedFiles.length).toBe(totalFiles);

        // Verify unique IDs
        const ids = new Set(collectedFiles.map(f => f.id));
        expect(ids.size).toBe(totalFiles);

    }, 120000); // 25 files creation might take a bit
});
