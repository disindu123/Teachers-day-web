// In-memory service doubles exist only in tests; production always uses Firebase.
import { randomUUID } from 'node:crypto';
export class MemoryDB {
  constructor() {
    this.data = new Map();
    this.queue = Promise.resolve();
  }
  collection(name) {
    return new Query(this, name);
  }
  async runTransaction(action) {
    const pending = this.queue.then(async () => {
      const writes = [];
      const tx = {
        get: async (ref) => ref.get(),
        set: (ref, data, options) => writes.push(() => ref.set(data, options)),
        create: (ref, data) => writes.push(() => ref.create(data)),
        update: (ref, data) => writes.push(() => ref.update(data)),
        delete: (ref) => writes.push(() => ref.delete()),
      };
      const result = await action(tx);
      for (const write of writes) await write();
      return result;
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
}
class Doc {
  constructor(db, collection, id) {
    Object.assign(this, { db, collection, id, key: `${collection}/${id}` });
  }
  async get() {
    const data = this.db.data.get(this.key);
    return { id: this.id, exists: !!data, data: () => (data ? { ...data } : undefined) };
  }
  async set(data, options) {
    this.db.data.set(
      this.key,
      options?.merge ? { ...this.db.data.get(this.key), ...data } : { ...data },
    );
  }
  async create(data) {
    if (this.db.data.has(this.key)) throw new Error('already exists');
    await this.set(data);
  }
  async update(data) {
    if (!this.db.data.has(this.key)) throw new Error('missing');
    await this.set(data, { merge: true });
  }
  async delete() {
    this.db.data.delete(this.key);
  }
}
class Query {
  constructor(db, name, filters = [], sorts = [], max = Infinity, after = []) {
    Object.assign(this, { db, name, filters, sorts, max, after });
  }
  doc(id = randomUUID()) {
    return new Doc(this.db, this.name, id);
  }
  where(field, op, value) {
    return new Query(
      this.db,
      this.name,
      [...this.filters, [field, op, value]],
      this.sorts,
      this.max,
      this.after,
    );
  }
  orderBy(field, direction = 'asc') {
    return new Query(
      this.db,
      this.name,
      this.filters,
      [...this.sorts, [typeof field === 'string' ? field : '__id', direction]],
      this.max,
      this.after,
    );
  }
  limit(max) {
    return new Query(this.db, this.name, this.filters, this.sorts, max, this.after);
  }
  startAfter(...after) {
    return new Query(this.db, this.name, this.filters, this.sorts, this.max, after);
  }
  async add(data) {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
  count() {
    return {
      get: async () => {
        const result = await this.get();
        return { data: () => ({ count: result.size }) };
      },
    };
  }
  async get() {
    let entries = [...this.db.data.entries()]
      .filter(([key]) => key.startsWith(`${this.name}/`))
      .map(([key, value]) => [key.slice(this.name.length + 1), value]);
    entries = entries.filter(([, value]) =>
      this.filters.every(([field, op, want]) =>
        op === '==' ? value[field] === want : op === '<' ? value[field] < want : false,
      ),
    );
    const get = (entry, field) =>
      field === '__id' ? entry[0] : (entry[1][field]?.toMillis?.() ?? entry[1][field]);
    entries.sort((a, b) => {
      for (const [field, dir] of this.sorts) {
        const aa = get(a, field),
          bb = get(b, field);
        if (aa !== bb) return (aa < bb ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
    if (this.after.length) {
      const [time, id] = this.after;
      entries = entries.filter(
        ([key, value]) =>
          value.createdAt?.toMillis() < time.toMillis() ||
          (value.createdAt?.toMillis() === time.toMillis() && key < id),
      );
    }
    const docs = entries
      .slice(0, this.max)
      .map(([id, value]) => ({ id, exists: true, data: () => ({ ...value }) }));
    return { docs, size: docs.length, empty: !docs.length };
  }
}
