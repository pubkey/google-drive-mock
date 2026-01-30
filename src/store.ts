export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    kind: string;
    parents?: string[];
    version: number;
    [key: string]: unknown;
}

export class DriveStore {
    private files: Map<string, DriveFile>;

    constructor() {
        this.files = new Map();
    }

    createFile(file: Partial<DriveFile> & { name: string }): DriveFile {
        if (!file.name) {
            throw new Error("File name is required");
        }
        const id = file.id || Math.random().toString(36).substring(7);
        const newFile: DriveFile = {
            kind: "drive#file",
            mimeType: "application/octet-stream",
            ...file,
            id,
            version: 1, // Initialize version
        };

        this.files.set(id, newFile);
        return newFile;
    }

    updateFile(id: string, updates: Partial<DriveFile>): DriveFile | null {
        const file = this.files.get(id);
        if (!file) return null;

        // Merge updates and increment version
        const updatedFile = {
            ...file,
            ...updates,
            version: file.version + 1
        };
        this.files.set(id, updatedFile);
        return updatedFile;
    }

    getFile(id: string): DriveFile | null {
        return this.files.get(id) || null;
    }

    deleteFile(id: string): boolean {
        return this.files.delete(id);
    }

    listFiles(): DriveFile[] {
        // Basic implementation, ignores query for now
        return Array.from(this.files.values());
    }

    getAbout(): object {
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
}

export const driveStore = new DriveStore();
