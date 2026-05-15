// One-shot setup script.
// Creates all roles, categories, channels, sets permissions, and posts
// every embed from ../discord-embeds/ with working buttons attached.
//
// Run once:  node setup.js
// Rollback:  node setup.js --rollback   (deletes everything it created)

require('dotenv').config();
const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits,
  ButtonStyle, ButtonBuilder, ActionRowBuilder,
} = require('discord.js');
const state = require('./lib/state');
const embeds = require('./lib/embeds');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ROLLBACK = process.argv.includes('--rollback');

if (!TOKEN || !GUILD_ID) {
  console.error('❌ Заполни .env: DISCORD_TOKEN и GUILD_ID');
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✓ Залогинились как ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  console.log(`✓ Сервер: ${guild.name}\n`);

  if (ROLLBACK) {
    await rollback(guild);
    client.destroy();
    return;
  }

  if (state.exists()) {
    console.log('⚠  state.json уже существует. Это значит setup уже запускался.');
    console.log('   Чтобы пересоздать с нуля — сделай: npm run rollback, потом npm run setup');
    console.log('   Я продолжу и докину только то, чего нет (idempotent).\n');
  }

  const s = state.load();
  s.guildId = GUILD_ID;

  await createRoles(guild, s);
  await configureBaseRolePermissions(guild, s);
  await createChannels(guild, s);
  await postEmbeds(guild, s);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✓ Setup завершён.');
  console.log('  Запусти бота: npm start');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  client.destroy();
});

// ═══════════════════════════════════════════════════════════════════
// ROLES
// ═══════════════════════════════════════════════════════════════════

const ROLE_SPECS = [
  { key: 'founder',      name: '👑 Основатель',    color: 0x8B0000, hoist: true },
  { key: 'admin',        name: '⚔️ Админ',          color: 0xDC2626, hoist: true },
  { key: 'moderator',    name: '🔧 Модератор',     color: 0xF97316, hoist: true },
  { key: 'contentmaker', name: '🎬 Контентмейкер', color: 0xA855F7, hoist: true },
  { key: 'veteran',      name: '🎖️ Ветеран',        color: 0xB45309, hoist: true },
  { key: 'survivor',     name: '✅ Выживший',      color: 0x374151 },
  { key: 'bots',         name: '🤖 Боты',          color: 0x5865F2 },
  // notification roles (hidden, no hoist)
  { key: 'notif_cherno',  name: 'notify-cherno',  color: 0 },
  { key: 'notif_livonia', name: 'notify-livonia', color: 0 },
  { key: 'notif_namalsk', name: 'notify-namalsk', color: 0 },
  { key: 'notif_events',  name: 'notify-events',  color: 0 },
  { key: 'notif_patches', name: 'notify-patches', color: 0 },
  { key: 'notif_lfg',     name: 'notify-lfg',     color: 0 },
  { key: 'notif_deals',   name: 'notify-deals',   color: 0 },
];

async function createRoles(guild, s) {
  console.log('— Роли');
  for (const spec of ROLE_SPECS) {
    if (s.roles[spec.key]) {
      const existing = await guild.roles.fetch(s.roles[spec.key]).catch(() => null);
      if (existing) { console.log(`  ✓ ${spec.name} (есть)`); continue; }
    }
    const role = await guild.roles.create({
      name: spec.name,
      color: spec.color,
      hoist: !!spec.hoist,
      mentionable: false,
      reason: 'FURY bot setup',
    });
    s.roles[spec.key] = role.id;
    state.save(s);
    console.log(`  + ${spec.name}`);
    await sleep(300);
  }
}

async function configureBaseRolePermissions(guild, s) {
  console.log('\n— Базовые права ролей');

  // Build perm arrays cumulatively so each role really inherits the level below.
  const survivorPerms = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.UseExternalStickers,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.UseVAD,
    PermissionFlagsBits.Stream,
    PermissionFlagsBits.UseApplicationCommands,
  ];
  const modPerms = [
    ...survivorPerms,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageThreads,
    PermissionFlagsBits.MuteMembers,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.DeafenMembers,
  ];
  const adminPerms = [
    ...modPerms,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageNicknames,
    PermissionFlagsBits.ManageGuildExpressions,
  ];

  // @everyone: только смотреть. Нет SendMessages — новички видят, но не пишут.
  await guild.roles.everyone.setPermissions([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
  console.log('  ✓ @everyone: view-only');

  const survivor = await guild.roles.fetch(s.roles.survivor);
  await survivor.setPermissions(survivorPerms);
  console.log('  ✓ ✅ Выживший: member perms');

  const mod = await guild.roles.fetch(s.roles.moderator);
  await mod.setPermissions(modPerms);
  console.log('  ✓ 🔧 Модератор: mod perms');

  const admin = await guild.roles.fetch(s.roles.admin);
  await admin.setPermissions(adminPerms);
  console.log('  ✓ ⚔️ Админ: admin perms');

  const founder = await guild.roles.fetch(s.roles.founder);
  await founder.setPermissions([PermissionFlagsBits.Administrator]);
  console.log('  ✓ 👑 Основатель: Administrator');
}

// ═══════════════════════════════════════════════════════════════════
// CHANNELS
// ═══════════════════════════════════════════════════════════════════

const CATEGORIES = [
  {
    key: 'cat_info', name: '▬▬▬  ИНФОРМАЦИЯ  ▬▬▬',
    channels: [
      { key: 'rules',         name: '📜-правила',          type: 'text' },
      { key: 'announcements', name: '📢-анонсы',           type: 'text' },
      { key: 'patchnotes',    name: '📰-патчноуты',        type: 'text' },
      { key: 'status',        name: '🗺️-статус-серверов',  type: 'text' },
      { key: 'store',         name: '🛒-магазин-донат',    type: 'text' },
      { key: 'faq',           name: '❓-faq',               type: 'text' },
    ],
  },
  {
    key: 'cat_chat', name: '▬▬▬  ОБЩЕНИЕ  ▬▬▬',
    channels: [
      { key: 'general',     name: '💬-общий-чат',         type: 'text' },
      { key: 'cherno',      name: '🏝️-chernarus',          type: 'text' },
      { key: 'livonia',     name: '🌲-livonia',           type: 'text' },
      { key: 'namalsk',     name: '❄️-namalsk',            type: 'text' },
      { key: 'lfg',         name: '🎯-поиск-сквада',      type: 'text' },
      { key: 'help',        name: '🆘-помощь-новичкам',   type: 'text' },
      { key: 'screenshots', name: '📸-скриншоты',         type: 'text' },
      { key: 'clips',       name: '🎬-клипы',              type: 'text' },
      { key: 'bases',       name: '🏚️-базы-и-постройки',   type: 'text' },
      { key: 'offtop',      name: '🎲-оффтоп',             type: 'text' },
      { key: 'bot_cmds',    name: '🤖-бот-команды',        type: 'text' },
    ],
  },
  {
    key: 'cat_events', name: '▬▬▬  СОБЫТИЯ  ▬▬▬',
    channels: [
      { key: 'killfeed_cherno',  name: '💀-killfeed-chernarus', type: 'text' },
      { key: 'killfeed_livonia', name: '💀-killfeed-livonia',   type: 'text' },
      { key: 'killfeed_namalsk', name: '💀-killfeed-namalsk',   type: 'text' },
      { key: 'cheater_bases',    name: '🔨-снесённые-базы',     type: 'text' },
      { key: 'events',           name: '📅-ивенты-и-вайпы',     type: 'text' },
    ],
  },
  {
    key: 'cat_support', name: '▬▬▬  ПОДДЕРЖКА  ▬▬▬',
    channels: [
      { key: 'tickets',     name: '🎫-создать-тикет', type: 'text' },
      { key: 'suggestions', name: '💡-предложения',   type: 'text' },
      { key: 'bugs',        name: '🐛-баг-репорты',   type: 'text' },
      { key: 'appeals',     name: '🛡️-разбан-апелляции', type: 'text' },
      { key: 'roles_pick',  name: '🔔-выбор-ролей',   type: 'text' },
    ],
  },
  {
    key: 'cat_voice', name: '▬▬▬  ГОЛОСОВЫЕ  ▬▬▬',
    channels: [
      { key: 'vc_online',  name: '📊 ОНЛАЙН: ─/─',  type: 'voice', noConnect: true },
      { key: 'vc_lobby',   name: '🔊 Лобби',         type: 'voice' },
      { key: 'vc_squad1',  name: '🎙️ Сквад 1',        type: 'voice' },
      { key: 'vc_squad2',  name: '🎙️ Сквад 2',        type: 'voice' },
      { key: 'vc_squad3',  name: '🎙️ Сквад 3',        type: 'voice' },
      { key: 'vc_duo',     name: '👥 Дуо',            type: 'voice', userLimit: 2 },
      { key: 'vc_solo',    name: '🧊 Соло-намальск',  type: 'voice', userLimit: 1 },
      { key: 'vc_1v1',     name: '💬 Разбор полётов', type: 'voice', userLimit: 2 },
      { key: 'vc_wait',    name: '⏳ Ожидание админа', type: 'voice' },
      { key: 'vc_afk',     name: '💤 AFK',            type: 'voice' },
    ],
  },
  {
    key: 'cat_staff', name: '▬▬▬  СТАФФ  ▬▬▬', staffOnly: true,
    channels: [
      { key: 'staff_chat',      name: '🛡️-staff-chat',      type: 'text' },
      { key: 'admin_logs',      name: '📋-admin-logs',      type: 'text' },
      { key: 'mod_actions',     name: '🔨-mod-actions',     type: 'text' },
      { key: 'tickets_archive', name: '🎫-tickets-archive', type: 'text' },
    ],
  },
];

async function createChannels(guild, s) {
  console.log('\n— Категории и каналы');

  const staffPerms = () => [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: s.roles.admin,        allow: [PermissionFlagsBits.ViewChannel] },
    { id: s.roles.moderator,    allow: [PermissionFlagsBits.ViewChannel] },
    { id: s.roles.founder,      allow: [PermissionFlagsBits.ViewChannel] },
  ];

  for (const cat of CATEGORIES) {
    let category;
    if (s.channels[cat.key]) {
      category = await guild.channels.fetch(s.channels[cat.key]).catch(() => null);
    }
    if (!category) {
      category = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: cat.staffOnly ? staffPerms() : undefined,
        reason: 'FURY bot setup',
      });
      s.channels[cat.key] = category.id;
      state.save(s);
      console.log(`  + ${cat.name}`);
      await sleep(300);
    } else {
      console.log(`  ✓ ${cat.name} (есть)`);
    }

    for (const ch of cat.channels) {
      if (s.channels[ch.key]) {
        const existing = await guild.channels.fetch(s.channels[ch.key]).catch(() => null);
        if (existing) { console.log(`    ✓ ${ch.name}`); continue; }
      }
      const opts = {
        name: ch.name,
        type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        reason: 'FURY bot setup',
      };
      if (ch.userLimit) opts.userLimit = ch.userLimit;
      if (cat.staffOnly) opts.permissionOverwrites = staffPerms();
      if (ch.noConnect) {
        opts.permissionOverwrites = [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.Connect] },
        ];
      }
      const channel = await guild.channels.create(opts);
      s.channels[ch.key] = channel.id;
      state.save(s);
      console.log(`    + ${ch.name}`);
      await sleep(300);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// EMBEDS
// ═══════════════════════════════════════════════════════════════════

async function postEmbeds(guild, s) {
  console.log('\n— Публикация embeds');

  // 1. Gate + verify button in #правила
  const rules = await guild.channels.fetch(s.channels.rules);
  const gate = embeds.load('01-gate.json', s.channels);
  const verifyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_accept')
      .setLabel('В ЛАГЕРЬ')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✅')
  );
  await rules.send({ embeds: gate.embeds, components: [verifyRow] });
  console.log('  + #правила: gate + кнопка В ЛАГЕРЬ');
  await sleep(500);

  // 2-5. Rules pins
  for (const f of ['02-rules-terms.json', '03-rules-common.json', '04-rules-building.json', '05-rules-raid.json']) {
    const data = embeds.load(f, s.channels);
    const msg = await rules.send({ embeds: data.embeds });
    await msg.pin().catch(() => {});
    console.log(`  + #правила: ${f}`);
    await sleep(500);
  }

  // 6. Connect info in #статус-серверов (status board itself is posted by bot.js)
  const statusChannel = await guild.channels.fetch(s.channels.status);
  const connect = embeds.load('07-connect.json', s.channels);
  await statusChannel.send({ embeds: connect.embeds });
  console.log('  + #статус-серверов: connect info');

  // 7. Tickets panel
  const tickets = await guild.channels.fetch(s.channels.tickets);
  const ticketsData = embeds.load('08-tickets.json', s.channels);
  const ticketRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_bug').setLabel('Баг').setEmoji('🐛').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_complaint').setLabel('Жалоба').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_appeal').setLabel('Апелляция').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_suggestion').setLabel('Предложение').setEmoji('💡').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_question').setLabel('Вопрос').setEmoji('❓').setStyle(ButtonStyle.Secondary),
  );
  await tickets.send({ embeds: ticketsData.embeds, components: [ticketRow] });
  console.log('  + #создать-тикет: 5 кнопок');
  await sleep(500);

  // 8. Roles picker
  const rolesCh = await guild.channels.fetch(s.channels.roles_pick);
  const rolesData = embeds.load('09-roles.json', s.channels);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('role_cherno').setLabel('Cherno').setEmoji('🏝️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_livonia').setLabel('Livonia').setEmoji('🌲').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_namalsk').setLabel('Namalsk').setEmoji('❄️').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('role_events').setLabel('Ивенты').setEmoji('📅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_patches').setLabel('Патчноуты').setEmoji('📰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_lfg').setLabel('LFG').setEmoji('🎯').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_deals').setLabel('Скидки').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
  );
  await rolesCh.send({ embeds: rolesData.embeds, components: [row1, row2] });
  console.log('  + #выбор-ролей: 7 кнопок');
  await sleep(500);

  // 9. FAQ
  const faq = await guild.channels.fetch(s.channels.faq);
  const faqData = embeds.load('12-faq.json', s.channels);
  await faq.send({ embeds: faqData.embeds });
  console.log('  + #faq');
}

// ═══════════════════════════════════════════════════════════════════
// ROLLBACK
// ═══════════════════════════════════════════════════════════════════

async function rollback(guild) {
  console.log('— Откат: удаляю всё, что создал setup');
  const s = state.load();

  for (const id of Object.values(s.channels)) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch) {
      await ch.delete('FURY bot rollback').catch(() => {});
      console.log(`  - канал ${id}`);
      await sleep(200);
    }
  }

  for (const id of Object.values(s.roles)) {
    const r = await guild.roles.fetch(id).catch(() => null);
    if (r) {
      await r.delete('FURY bot rollback').catch(() => {});
      console.log(`  - роль ${id}`);
      await sleep(200);
    }
  }

  state.reset();
  console.log('✓ Откат завершён. state.json удалён.');
}

client.login(TOKEN);
