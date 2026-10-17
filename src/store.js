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

// An unreadable file is set aside and the ids start over from here: never
// back to "2", whose devices may still be in Gladys.
const AFTER_LOSS = 1000;

export class ServerStore {
  constructor(dataDir = DATA_DIR) {
    this.path = join(dataDir, 'servers.json');
    this.dir = dataDir;
    /** @type {Array<{ id: string, url: string, username: string, password: string, allowSelfSigned: boolean }>} */
    this.servers = [];
    // The highest id ever given: a removed server's id is never reused, its
    // devices may still be in Gladys.
    this.lastId = 1;
    // Writes one after the other (two actions at once).
    this.writing = Promise.resolve();
  }

  async load() {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Added servers unreadable: ${err.message}`);
      }
      return;
    }
    try {
      const saved = JSON.parse(text);
      this.servers = Array.isArray(saved.servers) ? saved.servers.filter(valid) : [];
      this.lastId = Number.isInteger(saved.lastId) ? saved.lastId : 1;
    } catch (err) {
      logger.warn(`Added servers unreadable, file set aside: ${err.message}`);
      await rename(this.path, `${this.path}.bad`).catch(() => {});
      this.servers = [];
      this.lastId = AFTER_LOSS;
    }
  }

  /** Save a new state; memory changes only once it is on disk. */
  write(servers, lastId) {
    const run = this.writing.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify({ lastId, servers }), { mode: 0o600 });
      await rename(tmp, this.path);
      this.servers = servers;
      this.lastId = lastId;
    });
    this.writing = run.catch(() => {});
    return run;
  }

  /** A new server: its id ("2", "3"…, never reused) given once saved. */
  async add(settings) {
    await this.writing;
    const used = this.servers.map((entry) => Number(entry.id));
    const lastId = Math.max(this.lastId, ...used) + 1;
    const entry = { id: String(lastId), ...settings };
    await this.write([...this.servers, entry], lastId);
    return entry;
  }

  /** New settings of a server already added. */
  async update(id, settings) {
    await this.writing;
    const servers = this.servers.map((entry) =>
      entry.id === id ? { ...entry, ...settings } : entry,
    );
    await this.write(servers, this.lastId);
    return servers.find((entry) => entry.id === id);
  }

  async remove(id) {
    await this.writing;
    await this.write(
      this.servers.filter((entry) => entry.id !== id),
      this.lastId,
    );
  }
}
