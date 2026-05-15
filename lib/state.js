// Persisted state — created/updated by setup.js, read by bot.js.
// Holds IDs of roles, channels, and the live status board message
// so the bot can edit it instead of spamming new ones.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state.json');

function load() {
  if (!fs.existsSync(STATE_FILE)) {
    return { guildId: null, roles: {}, channels: {}, messages: {} };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function exists() {
  return fs.existsSync(STATE_FILE);
}

function reset() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

module.exports = { load, save, exists, reset, STATE_FILE };
