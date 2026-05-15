// One-shot wipe announcement.
// Usage:
//   node notify-wipe.js <server> [hoursFromNow]
//
// Examples:
//   node notify-wipe.js livonia          → анонс на +24ч (по умолчанию)
//   node notify-wipe.js livonia 6        → анонс на +6 часов
//   node notify-wipe.js cherno 48        → анонс на +48 часов
//   node notify-wipe.js namalsk 0        → "вайп прямо сейчас"

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const state = require('./lib/state');

const SERVERS = {
  cherno:  { name: 'CHERNARUS', emoji: '🏝️', roleKey: 'notif_cherno',  chatKey: 'cherno'  },
  livonia: { name: 'LIVONIA',   emoji: '🌲', roleKey: 'notif_livonia', chatKey: 'livonia' },
  namalsk: { name: 'NAMALSK',   emoji: '❄️', roleKey: 'notif_namalsk', chatKey: 'namalsk' },
};

const SERVER_KEY = process.argv[2];
const HOURS = parseFloat(process.argv[3] ?? '24');

if (!SERVERS[SERVER_KEY] || Number.isNaN(HOURS)) {
  console.error('Использование:  node notify-wipe.js <cherno|livonia|namalsk> [часов_до_вайпа]');
  console.error('Пример:         node notify-wipe.js livonia 6');
  process.exit(1);
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('❌ DISCORD_TOKEN не задан в .env'); process.exit(1); }

const cfg = SERVERS[SERVER_KEY];
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✓ Залогинились как ${client.user.tag}`);
  const s = state.load();

  const channel = await client.channels.fetch(s.channels.announcements).catch(() => null);
  if (!channel) {
    console.error('❌ #анонсы не найден. Запусти setup сначала.');
    client.destroy();
    process.exit(1);
  }

  const wipeTs = Math.floor((Date.now() + HOURS * 3600 * 1000) / 1000);
  const roleId = s.roles[cfg.roleKey];
  const chatId = s.channels[cfg.chatKey];
  const clipsId = s.channels.clips;

  const embed = {
    author: { name: `FURY • ${cfg.name}` },
    title: `${cfg.emoji}  ВАЙП ${cfg.name}`,
    description:
      `Все базы, тачки, лут и персонажи будут **стёрты**. Карта чистая, начинаем с побережья.\n\n` +
      `📅  **Дата:** <t:${wipeTs}:F>\n` +
      `⏱  **До вайпа:** <t:${wipeTs}:R>\n\n` +
      `**Что успеть:**\n` +
      `▸ Снять кодлоки если хочешь сохранить пароли\n` +
      `▸ Доехать на тачке туда, где не жалко её оставить\n` +
      `▸ Запилить итоговый клип своей базы — в <#${clipsId}>\n` +
      `▸ Рассчитаться с тиммейтами по долгам\n\n` +
      `**После вайпа:**\n` +
      `▸ Подписки на моды обновятся автоматически\n` +
      `▸ Донат-роли и купленные предметы сохраняются\n` +
      `▸ Флаг ставится туда, где первый встал`,
    color: 0x8B0000,
    footer: { text: `Обсуждаем в #${cfg.chatKey}  •  жалобы — в тикетах` },
    timestamp: new Date().toISOString(),
  };

  await channel.send({
    content: `<@&${roleId}>`,
    embeds: [embed],
    allowedMentions: { roles: [roleId] },
  });

  // Mirror to #admin-logs as an audit trail
  const logCh = await client.channels.fetch(s.channels.admin_logs).catch(() => null);
  if (logCh) {
    await logCh.send({
      embeds: [{
        title: `${cfg.emoji} Анонс вайпа: ${cfg.name}`,
        color: 0xDC2626,
        fields: [
          { name: 'Через',    value: `${HOURS}ч  ·  <t:${wipeTs}:F>`, inline: true },
          { name: 'Канал',    value: `<#${channel.id}>`,              inline: true },
          { name: 'Источник', value: 'notify-wipe.js (CLI)',          inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    }).catch(() => {});
  }

  console.log(`✓ Анонс вайпа ${cfg.name} опубликован в #анонсы`);
  console.log(`  Пинганул роль: notify-${SERVER_KEY}`);
  console.log(`  Вайп через: ${HOURS}ч`);
  console.log(`  Лог скинут в #admin-logs`);
  client.destroy();
});

client.login(TOKEN);
