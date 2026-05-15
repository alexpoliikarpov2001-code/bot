// Main bot runtime.
// Handles: verify button, ticket buttons, role-pick buttons, welcome/leave,
// live status board, live VC name with player count.

require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, ChannelType,
  ButtonStyle, ButtonBuilder, ActionRowBuilder, PermissionFlagsBits,
} = require('discord.js');
const state = require('./lib/state');
const dayz = require('./lib/dayz');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('❌ Заполни .env: DISCORD_TOKEN');
  process.exit(1);
}

if (!state.exists()) {
  console.error('❌ state.json не найден. Сначала запусти: npm run setup');
  process.exit(1);
}

const SERVERS = [
  { key: 'cherno',  emoji: '🏝️', name: 'CHERNARUS',
    host: process.env.CHERNO_HOST,  port: process.env.CHERNO_PORT,  display: process.env.CHERNO_DISPLAY },
  { key: 'livonia', emoji: '🌲', name: 'LIVONIA',
    host: process.env.LIVONIA_HOST, port: process.env.LIVONIA_PORT, display: process.env.LIVONIA_DISPLAY },
  { key: 'namalsk', emoji: '❄️', name: 'NAMALSK',
    host: process.env.NAMALSK_HOST, port: process.env.NAMALSK_PORT, display: process.env.NAMALSK_DISPLAY },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildMember],
});

client.once('ready', async () => {
  console.log(`✓ Бот онлайн: ${client.user.tag}`);
  console.log(`  Сервер: ${client.guilds.cache.size} guild(s)`);
  await masterLoop();             // first tick immediately
  setInterval(masterLoop, 60_000); // every minute
});

// ═══════════════════════════════════════════════════════════════════
// BUTTON INTERACTIONS
// ═══════════════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const id = interaction.customId;
  try {
    if (id === 'verify_accept')       return await handleVerify(interaction);
    if (id === 'ticket_close')        return await handleTicketClose(interaction);
    if (id.startsWith('ticket_'))     return await handleTicketOpen(interaction);
    if (id.startsWith('role_'))       return await handleRoleToggle(interaction);
  } catch (e) {
    console.error('[interaction]', id, e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Что-то пошло не так. Дёрни админа.', ephemeral: true }).catch(() => {});
    }
  }
});

async function handleVerify(interaction) {
  const s = state.load();
  const roleId = s.roles.survivor;
  if (!roleId) {
    return interaction.reply({ content: 'Роль не настроена. Запусти setup.', ephemeral: true });
  }
  if (interaction.member.roles.cache.has(roleId)) {
    return interaction.reply({ content: 'Ты уже в лагере. Удачи.', ephemeral: true });
  }
  await interaction.member.roles.add(roleId, 'Verified via rules gate');
  await interaction.reply({
    content: '✅ Добро пожаловать на побережье. Каналы открыты.',
    ephemeral: true,
  });
  console.log(`[verify] ${interaction.user.tag}`);
  await logAdmin(interaction.guild, {
    title: '✅ Прошёл правила',
    user: interaction.user,
    color: 0x22C55E,
  });
}

const TICKET_TYPES = {
  ticket_bug:        { name: 'баг',         emoji: '🐛', color: 0xF97316 },
  ticket_complaint:  { name: 'жалоба',      emoji: '⚔️', color: 0xDC2626 },
  ticket_appeal:     { name: 'апелляция',   emoji: '🛡️', color: 0x3B82F6 },
  ticket_suggestion: { name: 'предложение', emoji: '💡', color: 0x22C55E },
  ticket_question:   { name: 'вопрос',      emoji: '❓', color: 0x6B7280 },
};

async function handleTicketOpen(interaction) {
  const meta = TICKET_TYPES[interaction.customId];
  if (!meta) return;
  const s = state.load();
  await interaction.deferReply({ ephemeral: true });

  const parent = interaction.channel;
  const username = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'user';

  const thread = await parent.threads.create({
    name: `${meta.emoji}-${meta.name}-${username}`,
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 4320, // 3 дня без сообщений = архив
    reason: `Ticket from ${interaction.user.tag}`,
  });

  await thread.members.add(interaction.user.id);

  const closeBtn = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Закрыть тикет')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);

  await thread.send({
    content: `<@${interaction.user.id}>  <@&${s.roles.admin}>  <@&${s.roles.moderator}>`,
    embeds: [{
      author: { name: `FURY • Тикет: ${meta.name}` },
      description:
        `${meta.emoji} **Новый тикет: ${meta.name}**\n\n` +
        `Опиши ситуацию максимально подробно. Если это жалоба или апелляция — **обязательно приложи скрин или видео** (правило 3.5). Без пруфов рассматриваться не будет.\n\n` +
        `Когда вопрос решён — жми **🔒 Закрыть тикет**.`,
      color: meta.color,
      footer: { text: `Создал: ${interaction.user.tag} · ID: ${interaction.user.id}` },
      timestamp: new Date().toISOString(),
    }],
    components: [new ActionRowBuilder().addComponents(closeBtn)],
  });

  await interaction.editReply({ content: `✅ Тикет открыт: <#${thread.id}>` });
  console.log(`[ticket] ${interaction.user.tag} → ${meta.name}`);
  await logAdmin(interaction.guild, {
    title: `${meta.emoji} Открыт тикет: ${meta.name}`,
    user: interaction.user,
    channel: thread,
    color: meta.color,
  });
}

async function handleTicketClose(interaction) {
  const s = state.load();
  if (!interaction.channel?.isThread()) {
    return interaction.reply({ content: 'Закрывать можно только тикеты.', ephemeral: true });
  }

  // Stuff check: trust real Discord permissions (Admin/ManageThreads/ManageMessages)
  // as well as our named roles. This covers server owners and people with
  // Administrator perm regardless of which role gave it to them.
  const m = interaction.member;
  const isStaff =
    m.permissions.has(PermissionFlagsBits.Administrator) ||
    m.permissions.has(PermissionFlagsBits.ManageThreads) ||
    m.permissions.has(PermissionFlagsBits.ManageMessages) ||
    m.roles.cache.has(s.roles.admin) ||
    m.roles.cache.has(s.roles.moderator) ||
    m.roles.cache.has(s.roles.founder);

  // Author check: the first message in the thread is the bot's ticket embed
  // with footer "Создал: ... · ID: <userId>". Parse it out.
  let isAuthor = false;
  if (!isStaff) {
    try {
      const msgs = await interaction.channel.messages.fetch({ limit: 50 });
      const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const msg of sorted) {
        const footer = msg.embeds?.[0]?.footer?.text || '';
        const match = footer.match(/ID:\s*(\d+)/);
        if (match) {
          isAuthor = match[1] === interaction.user.id;
          break;
        }
      }
    } catch (_) { /* fall through */ }
  }

  if (!isStaff && !isAuthor) {
    return interaction.reply({ content: 'Закрыть может автор тикета или модератор.', ephemeral: true });
  }

  // Ephemeral ack to the clicker so Discord doesn't yell "Ошибка взаимодействия"
  await interaction.reply({
    content: '🔒 Закрываю тикет…',
    ephemeral: true,
  });

  const thread = interaction.channel;
  const threadName = thread.name;
  const threadId = thread.id;

  // Public close-confirmation in the thread itself
  await thread.send({
    embeds: [{
      description: `🔒 Тикет закрыт **${interaction.user.tag}**.\nТред будет заархивирован.\nПолный транскрипт — в <#${s.channels.tickets_archive}>.`,
      color: 0x374151,
    }],
  }).catch(e => console.error('[ticket-close] send fail:', e.message));

  // Save transcript to #tickets-archive BEFORE archiving the thread
  await archiveTicketTranscript(thread, interaction.user).catch(e =>
    console.error('[ticket-archive]', e.message));

  // Archive (no setLocked — locked threads need ManageThreads to even view;
  // archive alone is enough, anyone can reopen by writing into it)
  try {
    await thread.setArchived(true, `Closed by ${interaction.user.tag}`);
    console.log(`[ticket-close] archived ${threadName} by ${interaction.user.tag}`);
  } catch (e) {
    console.error(`[ticket-close] archive failed:`, e.message);
  }

  await logAdmin(interaction.guild, {
    title: '🔒 Тикет закрыт',
    user: interaction.user,
    extra: { 'Тред': `<#${threadId}>  \`${threadName}\`` },
    color: 0x374151,
  });
}

// Saves a closed ticket as a transcript embed + .txt attachment in #tickets-archive.
async function archiveTicketTranscript(thread, closedBy) {
  const s = state.load();
  const archiveCh = await thread.guild.channels.fetch(s.channels.tickets_archive).catch(() => null);
  if (!archiveCh) return;

  const msgs = await thread.messages.fetch({ limit: 100 });
  const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  // Build plain-text transcript
  const lines = sorted.map(m => {
    const t = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
    let content = m.content || '';
    if (m.embeds.length && !content) content = `[embed: ${m.embeds[0].title || m.embeds[0].description?.slice(0, 80) || '...'}]`;
    if (m.attachments.size) content += '  ' + [...m.attachments.values()].map(a => `📎 ${a.name}`).join(' ');
    return `[${t}]  ${m.author.tag}:  ${content}`;
  });
  const transcript = lines.join('\n') || '(пусто)';

  // Try to find original ticket author from the first embed footer
  let originalAuthor = '—';
  let ticketType = thread.name;
  for (const m of sorted) {
    const footer = m.embeds?.[0]?.footer?.text || '';
    const idMatch = footer.match(/Создал:\s*(\S+)\s*·\s*ID:\s*(\d+)/);
    if (idMatch) {
      originalAuthor = `${idMatch[1]} (\`${idMatch[2]}\`)`;
      break;
    }
  }

  await archiveCh.send({
    embeds: [{
      title: `🎫 Архив: ${thread.name}`,
      color: 0x374151,
      fields: [
        { name: 'Автор тикета', value: originalAuthor, inline: true },
        { name: 'Закрыл',       value: `<@${closedBy.id}>`, inline: true },
        { name: 'Сообщений',    value: String(sorted.length), inline: true },
        { name: 'Тред',         value: `[Открыть оригинал](${thread.url})`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
    files: [{
      attachment: Buffer.from(transcript, 'utf-8'),
      name: `${thread.name}.txt`,
    }],
  });
}

const ROLE_BUTTON_MAP = {
  role_cherno:  'notif_cherno',
  role_livonia: 'notif_livonia',
  role_namalsk: 'notif_namalsk',
  role_events:  'notif_events',
  role_patches: 'notif_patches',
  role_lfg:     'notif_lfg',
  role_deals:   'notif_deals',
};

async function handleRoleToggle(interaction) {
  const s = state.load();
  const roleKey = ROLE_BUTTON_MAP[interaction.customId];
  const roleId = s.roles[roleKey];
  if (!roleId) {
    return interaction.reply({ content: 'Роль не найдена. Перезапусти setup.', ephemeral: true });
  }
  const has = interaction.member.roles.cache.has(roleId);
  if (has) {
    await interaction.member.roles.remove(roleId);
    await interaction.reply({ content: '🔕 Подписка снята.', ephemeral: true });
  } else {
    await interaction.member.roles.add(roleId);
    await interaction.reply({ content: '🔔 Подписка оформлена.', ephemeral: true });
  }
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN LOG — posts an audit embed to #admin-logs
// ═══════════════════════════════════════════════════════════════════

async function logAdmin(guild, { title, user, channel, extra, color = 0x6B7280 }) {
  try {
    const s = state.load();
    const logCh = await guild.channels.fetch(s.channels.admin_logs).catch(() => null);
    if (!logCh) return;

    const fields = [];
    if (user) {
      fields.push({
        name: 'Пользователь',
        value: `<@${user.id}>\n\`${user.tag} · ${user.id}\``,
        inline: true,
      });
    }
    if (channel) {
      fields.push({
        name: 'Канал',
        value: `<#${channel.id}>`,
        inline: true,
      });
    }
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        fields.push({ name: k, value: String(v), inline: true });
      }
    }

    await logCh.send({
      embeds: [{
        title,
        color,
        fields,
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (e) {
    console.error('[logAdmin]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// WELCOME / LEAVE
// ═══════════════════════════════════════════════════════════════════

client.on('guildMemberAdd', async (member) => {
  const s = state.load();
  if (member.guild.id !== s.guildId) return;
  const ch = await member.guild.channels.fetch(s.channels.general).catch(() => null);
  if (ch) {
    await ch.send({
      content: `<@${member.id}>`,
      embeds: [{
        author: { name: 'FURY • DAYZ' },
        description:
          `**<@${member.id}> вышел к побережью.**\n` +
          `В рюкзаке пусто, в эфире — шум.\n\n` +
          `🗺️  Где играем — <#${s.channels.status}>\n` +
          `🆘  Не знаешь куда — <#${s.channels.help}>\n` +
          `🎯  Один не выживешь — <#${s.channels.lfg}>`,
        color: 0x8B0000,
        footer: { text: `Нас уже ${member.guild.memberCount}` },
      }],
    });
  }
  await logAdmin(member.guild, {
    title: '➡️  Зашёл на сервер',
    user: member.user,
    extra: { 'Аккаунт создан': `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
    color: 0x22C55E,
  });
}).on('guildMemberRemove', async (member) => {
  const s = state.load();
  if (member.guild.id !== s.guildId) return;
  const ch = await member.guild.channels.fetch(s.channels.general).catch(() => null);
  if (ch) {
    await ch.send({
      embeds: [{
        description: `*${member.user.username} ушёл в туман. F.*`,
        color: 0x374151,
      }],
    });
  }
  await logAdmin(member.guild, {
    title: '⬅️  Вышел с сервера',
    user: member.user,
    color: 0x6B7280,
  });
});

// ═══════════════════════════════════════════════════════════════════
// STATUS LOOP — queries servers + edits the live embed + renames VC
// ═══════════════════════════════════════════════════════════════════

let lastVcName = null;
let lastVcUpdate = 0;

async function masterLoop() {
  try {
    const s = state.load();
    const results = await Promise.all(SERVERS.map(srv =>
      dayz.query({ host: srv.host, port: srv.port })
    ));

    // ── status embed ───────────────────────────────────────────
    const totalOnline = results.reduce((a, r) => a + (r.ok ? r.online : 0), 0);
    const totalMax    = results.reduce((a, r) => a + (r.ok ? r.max : 0), 0);

    const fields = SERVERS.map((srv, i) => {
      const r = results[i];
      const display = srv.display || `${srv.host}:${srv.port}`;
      if (!r.ok) {
        return {
          name: `${srv.emoji}  ${srv.name}`,
          value: `❌ offline · \`${display}\`\n*${(r.error || '').slice(0, 80)}*`,
          inline: false,
        };
      }
      const bar = dayz.progressBar(r.online, r.max, 10);
      const hot = r.online >= r.max ? '  🔥' : '';
      const queueLine = r.queue > 0 ? `  ·  очередь: \`${r.queue}\`` : '';
      return {
        name: `${srv.emoji}  ${srv.name}`,
        value: `\`${r.online}/${r.max}\` ${bar}${hot}${queueLine}\n\`${display}\``,
        inline: false,
      };
    });

    const embed = {
      author: { name: 'FURY • СТАТУС СЕРВЕРОВ' },
      description: `*обновлено · <t:${Math.floor(Date.now() / 1000)}:R>*`,
      color: 0x8B0000,
      fields,
      footer: { text: `Всего онлайн: ${totalOnline} / ${totalMax}  •  обновляется каждую минуту` },
    };

    // Edit existing message or post new one
    const statusCh = await client.channels.fetch(s.channels.status).catch(() => null);
    if (statusCh) {
      let msg = null;
      if (s.messages.statusBoard) {
        msg = await statusCh.messages.fetch(s.messages.statusBoard).catch(() => null);
      }
      if (msg) {
        await msg.edit({ embeds: [embed] });
      } else {
        msg = await statusCh.send({ embeds: [embed] });
        s.messages.statusBoard = msg.id;
        state.save(s);
        console.log('✓ статус-сообщение создано');
      }
    }

    // ── VC name (rate-limited: 2 changes per 10 min per channel) ──
    const newName = `📊 ОНЛАЙН: ${totalOnline}/${totalMax}`;
    const now = Date.now();
    if (newName !== lastVcName && (now - lastVcUpdate) >= 5 * 60_000) {
      const vc = await client.channels.fetch(s.channels.vc_online).catch(() => null);
      if (vc) {
        try {
          await vc.setName(newName);
          lastVcName = newName;
          lastVcUpdate = now;
        } catch (e) {
          // rate limit or perms — silently skip, retry next tick
        }
      }
    }
  } catch (e) {
    console.error('[masterLoop]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════

process.on('SIGINT', () => { console.log('\n— выключаюсь'); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });

client.login(TOKEN);
