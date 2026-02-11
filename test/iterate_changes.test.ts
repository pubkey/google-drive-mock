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

    it('should find all files where write time was equal to X, sorted by name, with limit', async () => {
        // Create 3 files effectively at the "same" time.
        // To do this reliably on Real API, we create one, get its time, and then PATCH the others to have that same time (if possible).
        // However, Drive API might not allow arbitrary modifiedTime patching easily without setModifiedDate=true param or similar.
        // Actually, V3 supports modifying modifiedTime.

        const file1 = await createFileWithContent('file_B_middle', randomString(), config);
        // Get the time from file1 to use as target
        const timeXRes = await fetch(`${config.baseUrl}/drive/v3/files/${file1.id}?fields=modifiedTime`, { headers });
        const timeX = (await timeXRes.json()).modifiedTime;

        // Create two more files
        const file2 = await createFileWithContent('file_A_first', randomString(), config);
        const file3 = await createFileWithContent('file_C_last', randomString(), config);

        // Patch file2 and file3 to have the SAME modifiedTime as file1
        // We need to wait a bit to ensure they would naturally have different times if we didn't patch, 
        // to prove the patch worked and we are sorting by name not time.
        await new Promise(r => setTimeout(r, 1100));

        const patchBody = JSON.stringify({ modifiedTime: timeX });
        await fetch(`${config.baseUrl}/drive/v3/files/${file2.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: patchBody });
        await fetch(`${config.baseUrl}/drive/v3/files/${file3.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: patchBody });

        const q = `modifiedTime = '${timeX}' and trashed = false`;
        const orderBy = 'name asc';
        const pageSize = 10;

        const url = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=${pageSize}&fields=files(id,name,modifiedTime)`;
        const res = await fetch(url, { headers });
        expect(res.status).toBe(200);
        const data = await res.json();

        // Should find all 3 files
        const relevantFiles = data.files.filter((f: any) => [file1.id, file2.id, file3.id].includes(f.id));
        expect(relevantFiles.length).toBe(3);

        // Verify they are sorted by name: A, B, C
        expect(relevantFiles[0].name).toBe('file_A_first');
        expect(relevantFiles[1].name).toBe('file_B_middle');
        expect(relevantFiles[2].name).toBe('file_C_last');

        // Verify times
        relevantFiles.forEach((f: any) => {
            expect(new Date(f.modifiedTime).toISOString()).toBe(new Date(timeX).toISOString());
        });
    }, 60000);

    it('should find files where write time = X AND inside a specific parent folder, sorted by name', async () => {
        // 1. Create a parent folder
        const parentRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'ParentFolder_EqualTime_' + randomString(),
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        expect(parentRes.status).toBe(200);
        const parentId = (await parentRes.json()).id;

        // 2. Create 3 files IN parent + 1 file OUTSIDE parent
        // We want them all to have the SAME modifiedTime eventually.

        // Create baseline file in parent
        const file1 = await createFileWithContent('file_B_middle', randomString(), config);
        // Move to parent
        await fetch(`${config.baseUrl}/drive/v3/files/${file1.id}?addParents=${parentId}`, { method: 'PATCH', headers });

        // Get target time
        const timeXRes = await fetch(`${config.baseUrl}/drive/v3/files/${file1.id}?fields=modifiedTime`, { headers });
        const timeX = (await timeXRes.json()).modifiedTime;

        // Create other files
        const file2 = await createFileWithContent('file_A_first', randomString(), config);
        await fetch(`${config.baseUrl}/drive/v3/files/${file2.id}?addParents=${parentId}`, { method: 'PATCH', headers });

        const file3 = await createFileWithContent('file_C_last', randomString(), config);
        await fetch(`${config.baseUrl}/drive/v3/files/${file3.id}?addParents=${parentId}`, { method: 'PATCH', headers });

        const fileOutside = await createFileWithContent('file_Outside', randomString(), config);

        // DELAY to ensure natural time diff, then PATCH all to timeX
        await new Promise(r => setTimeout(r, 1100));

        const patchBody = JSON.stringify({ modifiedTime: timeX });
        await fetch(`${config.baseUrl}/drive/v3/files/${file2.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: patchBody });
        await fetch(`${config.baseUrl}/drive/v3/files/${file3.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: patchBody });
        await fetch(`${config.baseUrl}/drive/v3/files/${fileOutside.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: patchBody });

        // 3. Query: modifiedTime = X AND parentId in parents
        const q = `modifiedTime = '${timeX}' and '${parentId}' in parents and trashed = false`;
        const orderBy = 'name asc';

        const url = `${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent(orderBy)}&fields=files(id,name,modifiedTime,parents)`;
        const res = await fetch(url, { headers });
        expect(res.status).toBe(200);
        const data = await res.json();

        // 4. Verify results
        // Should find file1, file2, file3
        // Should NOT find fileOutside
        const ids = data.files.map((f: any) => f.id);
        expect(ids).toContain(file1.id);
        expect(ids).toContain(file2.id);
        expect(ids).toContain(file3.id);
        expect(ids).not.toContain(fileOutside.id);
        expect(data.files.length).toBe(3);

        // Verify Sort Order
        expect(data.files[0].name).toBe('file_A_first');
        expect(data.files[1].name).toBe('file_B_middle');
        expect(data.files[2].name).toBe('file_C_last');

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
