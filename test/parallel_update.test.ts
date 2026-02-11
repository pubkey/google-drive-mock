
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Parallel Content Update Test', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    // Helper from user request (adapted)
    async function updateDocumentFiles<DocType>(
        googleDriveOptions: { apiEndpoint: string, authToken: string },
        primaryPath: string,
        docs: DocType[],
        fileIdByDocId: Record<string, string>,
        concurrency = 5
    ) {
        const queue = [...docs];
        const results: Record<string, { id: string }> = {};

        async function worker() {
            while (queue.length) {
                const doc = queue.shift()!;

                const docId = (doc as Record<string, unknown>)[primaryPath] as string;
                const fileId = fileIdByDocId[docId];

                if (!fileId) throw new Error(`File ID not found for doc ${docId}`);

                const url =
                    googleDriveOptions.apiEndpoint +
                    `/upload/drive/v3/files/${encodeURIComponent(fileId)}` +
                    `?uploadType=media&supportsAllDrives=true&fields=id`;

                const res = await fetch(url, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${googleDriveOptions.authToken}`,
                        "Content-Type": "application/json; charset=UTF-8",
                    },
                    body: JSON.stringify(doc),
                });

                if (!res.ok) {
                    const text = await res.text().catch(() => "");
                    throw new Error(`GDR15: Update failed for ${docId}. Status: ${res.status}. Error: ${text}`);
                }

                results[docId] = await res.json(); // { id }
            }
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return results;
    }


    async function createFile(name: string, content: unknown): Promise<string> {
        const metadata = {
            name: name,
            parents: [config.testFolderId],
            mimeType: 'application/json'
        };
        const multipartBoundary = '-------TestBoundary' + Date.now();
        const delimiter = '\r\n--' + multipartBoundary + '\r\n';
        const closeDelim = '\r\n--' + multipartBoundary + '--';

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(content) +
            closeDelim;

        const res = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=multipart&fields=id`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + config.token,
                'Content-Type': 'multipart/related; boundary="' + multipartBoundary + '"'
            },
            body: body
        });
        if (!res.ok) throw new Error(`Create failed: ${res.status}`);
        const data = await res.json();
        return data.id;
    }

    it('should update file contents in parallel', async () => {
        const docCount = 5;
        const docs = [];
        const fileIdByDocId: Record<string, string> = {};

        // 1. Create initial files
        console.log(`Creating ${docCount} initial files...`);
        for (let i = 0; i < docCount; i++) {
            const docId = `doc_${Date.now()}_${i}`;
            const initialContent = { id: docId, data: 'initial' };
            const fileName = `${docId}.json`;
            const fileId = await createFile(fileName, initialContent);
            fileIdByDocId[docId] = fileId;
            docs.push({ id: docId, data: 'updated_' + i, random: Math.random() });
        }

        // 2. Run parallel update
        console.log('Running parallel updates...');
        await updateDocumentFiles(
            { apiEndpoint: config.baseUrl, authToken: config.token },
            'id',
            docs,
            fileIdByDocId,
            3 // Concurrency
        );

        // 3. Verify updates
        console.log('Verifying content...');
        for (const doc of docs) {
            const fileId = fileIdByDocId[doc.id];
            const url = `${config.baseUrl}/drive/v3/files/${fileId}?alt=media`;
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${config.token}` }
            });
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);
            const downloadedContent = await res.json();

            // Note: Drive might not return exact JSON identical if it adds properties?
            // Usually strict JSON equality works.
            expect(downloadedContent).toEqual(doc);
        }

    }, 30000);
});
