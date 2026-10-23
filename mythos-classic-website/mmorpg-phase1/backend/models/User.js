// Tiny file-based user store for easy local setup. No database installation required.
// For a public production MMO, replace this with a managed database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'users.json');
let writeQueue = Promise.resolve();

async function readUsers() {
  await fs.promises.mkdir(dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.promises.readFile(dataFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.promises.writeFile(dataFile, '[]\n', 'utf8');
    return [];
  }
}

function saveUsers(users) {
  writeQueue = writeQueue.then(async () => {
    await fs.promises.mkdir(dataDir, { recursive: true });
    const tempFile = `${dataFile}.tmp`;
    await fs.promises.writeFile(tempFile, JSON.stringify(users, null, 2) + '\n', 'utf8');
    await fs.promises.rename(tempFile, dataFile);
  });
  return writeQueue;
}

function matches(user, query = {}) {
  if (Array.isArray(query.$or)) return query.$or.some((part) => matches(user, part));
  return Object.entries(query).every(([key, value]) => String(user[key]) === String(value));
}

class UserQuery {
  constructor(work) { this.work = work; }
  select() { return this; }
  then(resolve, reject) { return this.work().then(resolve, reject); }
  catch(reject) { return this.work().catch(reject); }
}

const User = {
  findOne(query) {
    return new UserQuery(async () => (await readUsers()).find((user) => matches(user, query)) || null);
  },
  findById(id) {
    return new UserQuery(async () => (await readUsers()).find((user) => user._id === String(id)) || null);
  },
  async create(input) {
    const users = await readUsers();
    if (users.some((user) => user.email === input.email)) {
      const error = new Error('Duplicate email'); error.code = 11000; throw error;
    }
    if (users.some((user) => user.username.toLowerCase() === input.username.toLowerCase())) {
      const error = new Error('Duplicate username'); error.code = 11000; throw error;
    }
    const user = {
      _id: crypto.randomUUID(),
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role || 'player',
      banned: false,
      character: { x: 45, y: 45, hp: 30, maxHp: 30, coins: 25, xp: 0, level: 1, questDone: false, inventory: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(user);
    await saveUsers(users);
    return user;
  },
  async findByIdAndUpdate(id, update) {
    const users = await readUsers();
    const user = users.find((entry) => entry._id === String(id));
    if (!user) return null;
    const changes = update && update.$set ? update.$set : (update || {});
    for (const [key, value] of Object.entries(changes)) user[key] = value;
    user.updatedAt = new Date().toISOString();
    await saveUsers(users);
    return user;
  }
};

module.exports = User;
