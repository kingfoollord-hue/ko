async function connectDatabase() {
  // The beginner-friendly edition stores accounts in backend/data/users.json.
  // It starts automatically and does not need MongoDB installed.
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const usersFile = path.join(dataDir, 'users.json');
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '[]\n', 'utf8');
  console.log('Local save file ready: backend/data/users.json');
}
module.exports = { connectDatabase };
