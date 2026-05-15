// Loads embed JSONs from ../../discord-embeds/ and substitutes the
// <#XXX_CHANNEL_ID> placeholders with real channel IDs.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'discord-embeds');

const PLACEHOLDER_MAP = {
  '<#HELP_CHANNEL_ID>':         'help',
  '<#FAQ_CHANNEL_ID>':          'faq',
  '<#RULES_CHANNEL_ID>':        'rules',
  '<#TICKETS_CHANNEL_ID>':      'tickets',
  '<#STATUS_CHANNEL_ID>':       'status',
  '<#PATCHNOTES_CHANNEL_ID>':   'patchnotes',
  '<#LFG_CHANNEL_ID>':          'lfg',
  '<#ANNOUNCEMENTS_CHANNEL_ID>':'announcements',
};

function loadRaw(filename) {
  const raw = fs.readFileSync(path.join(DIR, filename), 'utf-8');
  const obj = JSON.parse(raw);
  // strip _comment_* keys that we added for documentation
  for (const k of Object.keys(obj)) {
    if (k.startsWith('_')) delete obj[k];
  }
  return obj;
}

function load(filename, channelIds = {}) {
  let s = JSON.stringify(loadRaw(filename));
  for (const [placeholder, key] of Object.entries(PLACEHOLDER_MAP)) {
    const id = channelIds[key];
    if (id) s = s.split(placeholder).join(`<#${id}>`);
  }
  return JSON.parse(s);
}

module.exports = { load, loadRaw };
