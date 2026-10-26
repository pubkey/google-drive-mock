import { describe, expect, beforeAll, afterAll } from 'vitest';
import { it } from './config';
import { getTestConfig, TestConfig } from './config';

/**
 * Inside of query string literals, ' must be escaped as \' and \ as \\.
 * Keywords and parentheses inside of literals must not be parsed.
 * @link https://developers.google.com/workspace/drive/api/guides/ref-search-terms
 */
function escapeQueryValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

describe('Query string literal escaping', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    const names = [
        "a'b.json",
        "a'b'c.json",
        'a\\b.json',
        'ab\\.json',
        "a\\'b.json",
        'x and y.json',
        'x or y.json',
        'x AND y.json',
        'a(b.json',
        'a)b.json',
        '(ab).json',
        'a b.json',
        'a%b.json',
        'a&b.json',
        'a#b.json',
        'a:b.json',
        'a*b.json',
        'a.b.json',
        'a,b.json',
        'a~b.json',
        'a[b]{c}.json',
        'äö😊.json'
    ];

    async function createFolder(): Promise<string> {
        const res = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'QueryEscapingFolder_' + Math.random().toString(36).substring(2),
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        expect(res.status).toBe(200);
        return (await res.json()).id;
    }

    async function createFiles(parentId: string) {
        for (const name of names) {
            const res = await fetch(`${config.baseUrl}/drive/v3/files`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' })
            });
            if (!res.ok) throw new Error(`Failed to create file ${name}: ${res.status}`);
        }
    }

    async function query(q: string): Promise<string[]> {
        const res = await fetch(`${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        return data.files.map((f: { name: string }) => f.name).sort();
    }

    it('should find each file by its escaped name', async () => {
        const parentId = await createFolder();
        await createFiles(parentId);
        for (const name of names) {
            const found = await query(`name = '${escapeQueryValue(name)}' and trashed = false and '${parentId}' in parents`);
            expect(found, name).toEqual([name]);
        }
    }, 120000);

    it('should find all files with a single or-query', async () => {
        const parentId = await createFolder();
        await createFiles(parentId);
        const nameClause = names.map(name => `name = '${escapeQueryValue(name)}'`).join(' or ');
        const found = await query(`(${nameClause}) and trashed = false and '${parentId}' in parents`);
        expect(found).toEqual([...names].sort());
    }, 120000);

    it('should exclude files with name != and the escaped name', async () => {
        const parentId = await createFolder();
        await createFiles(parentId);
        const found = await query(`name != '${escapeQueryValue("a'b'c.json")}' and trashed = false and '${parentId}' in parents`);
        expect(found).toEqual(names.filter(name => name !== "a'b'c.json").sort());
    }, 120000);
});
