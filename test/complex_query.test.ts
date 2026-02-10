
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Complex Query Support', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should support nested OR logic with special characters and parentheses', async () => {
        // 1. Create a parent folder
        const folderRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'ComplexQueryFolder', mimeType: 'application/vnd.google-apps.folder' })
        });
        expect(folderRes.status).toBe(200);
        const folder = await folderRes.json();
        const parentId = folder.id;

        // 2. Create files
        const names = [
            'foobar.json',
            'oTßu👵obf.json',
            'WcQ}eAXMD.json',
            '}{v😃ÄÄÄ😃.json',
            'Dwxt7wC8TI.json',
            'tÄIQ16o3kzÜö.json',
            '4XzHyUYepkx.json',
            'IzÄ]👵pZwv.json',
            "ÖdIä💩8g6'.json", // Filename containing a single quote
            'o🍌kB5wD.json'
        ];

        // Create files inside parent
        for (const name of names) {
            const res = await fetch(`${config.baseUrl}/drive/v3/files`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' })
            });
            if (!res.ok) throw new Error(`Failed to create file ${name}: ${res.status}`);
        }

        // Create a distractor file inside same parent
        await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'ShouldNotBeFound.json', parents: [parentId], mimeType: 'application/json' })
        });

        // Create a file with same name but OUTSIDE parent (should not be found)
        await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: names[0], mimeType: 'application/json' }) // No parent (root)
        });

        // 3. Construct query
        // Logic: (name = '...' or name = '...' ...) and trashed = false and 'parentId' in parents
        const nameClause = names.map(n => `name = '${n.replace(/'/g, "\\'")}'`).join(' or ');
        const query = `(${nameClause}) and trashed = false and '${parentId}' in parents`;

        console.log('Query:', query);

        const res = await fetch(`${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.files).toBeDefined();
        expect(data.files.length).toBe(names.length);

        // Verify names
        const foundNames = data.files.map((f: any) => f.name).sort();
        const expectedNames = [...names].sort();
        expect(foundNames).toEqual(expectedNames);
    }, 60000); // 60s timeout for bulk creation
});
