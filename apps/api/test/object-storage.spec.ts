import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalObjectStorage, ObjectStorage } from '../src/storage/object-storage';

describe('LocalObjectStorage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storage-spec-'));
  const storage: ObjectStorage = new LocalObjectStorage(dir);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stores and reads back by key', async () => {
    await storage.put('contracts/org1/flow1.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
    expect((await storage.get('contracts/org1/flow1.pdf'))?.toString()).toBe('%PDF-1.4');
    expect(await storage.get('contracts/org1/missing.pdf')).toBeNull();
  });

  it('rejects keys that escape the storage directory', async () => {
    await expect(storage.put('../escape.pdf', Buffer.from('x'), 'application/pdf')).rejects.toThrow();
    await expect(storage.get('contracts/../../etc/passwd')).rejects.toThrow();
    await expect(storage.get('/etc/passwd')).rejects.toThrow();
  });
});
