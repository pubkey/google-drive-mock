import * as crypto from 'crypto';

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    kind: string;
    parents?: string[];
    version: number;
    etag: string;
    trashed: boolean;
    createdTime: string;
    modifiedTime: string;
    size: string;
    md5Checksum: string;
    [key: string]: unknown;
}

export interface DriveChange {
    kind: "drive#change";
    changeType: "file" | "drive";
    time: string;
    removed: boolean;
    fileId: string;
    file?: DriveFile;
}

export interface DriveAbout {
    user: {
        displayName: string;
        emailAddress: string;
        kind: string;
        me: boolean;
        permissionId: string;
    };
    storageQuota: {
        limit: string;
        usage: string;
        usageInDrive: string;
        usageInDriveTrash: string;
    };
}

export class DriveStore {
    private files: Map<string, DriveFile>;
    private changes: DriveChange[];

    constructor() {
        this.files = new Map();
        this.changes = [];
    }

    private calculateStats(content: unknown): { size: string, md5Checksum: string } {
        let buffer: Buffer;
        if (typeof content === 'string') {
            buffer = Buffer.from(content);
        } else if (content === undefined || content === null) {
            buffer = Buffer.from('');
        } else {
            buffer = Buffer.from(JSON.stringify(content));
        }

        return {
            size: String(buffer.length),
            md5Checksum: crypto.createHash('md5').update(buffer).digest('hex')
        };
    }

    createFile(file: Partial<DriveFile> & { name: string }): DriveFile {
        if (!file.name) {
            throw new Error("File name is required");
        }
        const id = file.id || Math.random().toString(36).substring(7);
        const now = new Date().toISOString();

        const stats = this.calculateStats(file.content);

        const newFile: DriveFile = {
            kind: "drive#file",
            mimeType: "application/octet-stream",
            trashed: false,
            createdTime: now,
            modifiedTime: now,

            ...file,
            id,
            version: 1, // Initialize version
            etag: "1", // Initialize etag
            // Ensure calculated stats override provided ones
            size: stats.size,
            md5Checksum: stats.md5Checksum
        };

        this.files.set(id, newFile);
        this.addChange(newFile);
        return newFile;
    }

    updateFile(id: string, updates: Partial<DriveFile>): DriveFile | null {
        const file = this.files.get(id);
        if (!file) return null;

        // If content is being updated, recalculate stats
        let statsUpdates = {};
        if (updates.content !== undefined) {
            statsUpdates = this.calculateStats(updates.content);
        }

        // Merge updates and increment version
        const newVersion = file.version + 1;
        const updatedFile = {
            ...file,
            ...updates,
            ...statsUpdates,
            version: newVersion,
            etag: String(newVersion),
            modifiedTime: new Date().toISOString()
        };
        this.files.set(id, updatedFile);
        this.addChange(updatedFile);
        return updatedFile;
    }

    getFile(id: string): DriveFile | null {
        return this.files.get(id) || null;
    }

    deleteFile(id: string): boolean {
        const file = this.files.get(id);
        const deleted = this.files.delete(id);
        if (deleted && file) {
            this.addChange(file, true);
        }
        return deleted;
    }

    listFiles(): DriveFile[] {
        // Basic implementation, ignores query for now
        return Array.from(this.files.values());
    }

    clear(): void {
        this.files.clear();
        this.changes = [];
    }

    getAbout(): DriveAbout {
        return {
            user: {
                displayName: "Mock User",
                emailAddress: "mock@example.com",
                kind: "drive#user",
                me: true,
                permissionId: "mock-permission-id"
            },
            storageQuota: {
                limit: "10000000000",
                usage: "0",
                usageInDrive: "0",
                usageInDriveTrash: "0"
            }
        }
    }

    // Change Management
    private addChange(file: DriveFile, removed: boolean = false) {
        // Simple mock implementation: store change
        // In real Drive, multiple updates might result in one change token if polled later,
        // but here we just append to a log.
        const change: DriveChange = {
            kind: "drive#change",
            changeType: "file",
            time: new Date().toISOString(),
            removed,
            fileId: file.id,
            file: removed ? undefined : file
        };
        this.changes.push(change);
    }

    getStartPageToken(): string {
        return String(this.changes.length + 1);
    }

    getChanges(pageToken: string): { changes: DriveChange[], newStartPageToken: string, nextPageToken?: string } {
        const tokenIndex = parseInt(pageToken, 10);

        // If token invalid, default to beginning? Or error?
        // Real API returns 400 for bad token. 
        // Mock: treat 0 or NaN as start.
        const start = isNaN(tokenIndex) ? 0 : Math.max(0, tokenIndex - 1);

        // Return all changes since token
        const changes = this.changes.slice(start);
        const newToken = String(this.changes.length + 1);

        return {
            changes,
            newStartPageToken: newToken
        };
    }
}

export const driveStore = new DriveStore();
