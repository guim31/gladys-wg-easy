// -----------------------------------------------------------------------------
// The wg-easy servers added by the configuration action, kept in
// /data/servers.json (the one writable volume of the sandbox). Their
// passwords are there as the configuration's are in Gladys: never in the
// logs, never in a device param.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'wg-easy-store' });

export const DATA_DIR = process.env.DATA_DIR || '/data';

const valid = (entry) =>
  entry &&
  typeof entry.id === 'string' &&
  /^\d+$/.test(entry.id) &&
  entry.id !== '1' &&
  typeof entry.url === 'string';

export class ServerStore {
  constructor(dataDir = DATA_DIR) {
    this.path = join(dataDir, 'servers.json');
    this.dir = dataDir;
    /** @type {Array<{ id: string, url: string, username: string, password: string, allowSelfSigned: boolean }>} */
    this.servers = [];
    // The highest id ever given: a removed server's id is never reused, its
    // devices may still be in Gladys.
    this.lastId = 1;
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      this.servers = Array.isArray(saved.servers) ? saved.servers.filter(valid) : [];
      this.lastId = Number.isInteger(saved.lastId) ? saved.lastId : 1;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Added servers unreadable, none kept: ${err.message}`);
      }
      this.servers = [];
      this.lastId = 1;
    }
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({ lastId: this.lastId, servers: this.servers }), {
      mode: 0o600,
    });
    await rename(tmp, this.path);
  }

  /** "2", "3"…: never reused (the ids of its devices). Saved by `put`. */
  nextId() {
    const used = this.servers.map((entry) => Number(entry.id));
    this.lastId = Math.max(this.lastId, ...used) + 1;
    return String(this.lastId);
  }

  async put(entry) {
    const index = this.servers.findIndex((saved) => saved.id === entry.id);
    if (index >= 0) {
      this.servers[index] = entry;
    } else {
      this.servers.push(entry);
    }
    await this.save();
  }

  async remove(id) {
    this.servers = this.servers.filter((entry) => entry.id !== id);
    await this.save();
  }
}
