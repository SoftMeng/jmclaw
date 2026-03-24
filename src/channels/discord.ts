import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
} from 'discord.js';
import { ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

import { ASSISTANT_NAME, TRIGGER_PATTERN, GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { generatePrompt, presetPrompts } from '../prompts.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

// Configuration: whether to add --optimize flag to prompts
const ADD_OPTIMIZE = process.env.GLMCLAW_ADD_OPTIMIZE !== 'false';

// Set up proxy if environment variable is set
async function setupProxy(): Promise<void> {
  const proxyUrl =
    process.env.https_proxy || process.env.HTTPS_PROXY || process.env.ALL_PROXY;
  if (proxyUrl) {
    logger.info({ proxy: proxyUrl }, 'Discord will use proxy for REST API');
  }
}

// Create a proxy dispatcher for discord.js REST (only for small API calls)
// File uploads will be sent without proxy for better compatibility
function createProxyDispatcher(): Dispatcher | undefined {
  // Don't use proxy for REST - file uploads fail with HTTP proxy
  return undefined;
}

// Create a proxy agent for fetch calls (attachment downloads)
let proxyAgent: ProxyAgent | undefined;
function getProxyAgent(): ProxyAgent | undefined {
  if (proxyAgent) return proxyAgent;
  const proxyUrl =
    process.env.https_proxy || process.env.HTTPS_PROXY || process.env.ALL_PROXY;
  if (!proxyUrl) return undefined;
  try {
    proxyAgent = new ProxyAgent(proxyUrl);
    return proxyAgent;
  } catch (err) {
    logger.warn({ err }, 'Failed to create proxy agent for fetch');
    return undefined;
  }
}

// Handle image generation request - returns true if this is an image generation request
// The agent will handle prompt optimization and ComfyUI generation
function isImageGenerationRequest(content: string): boolean {
  return (
    content.includes('生成图片') ||
    content.includes('画一张') ||
    content.includes('画一幅')
  );
}

// Send image file to Discord using curl with SOCKS5 proxy
async function sendImageToDiscord(
  imagePath: string,
  channelId: string,
): Promise<boolean> {
  // Get token from environment or env file
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const botToken = process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN;

  if (!botToken) {
    console.log('[Discord] No bot token found');
    return false;
  }

  try {
    // Use curl with SOCKS5 proxy to upload the file
    // Properly escape the header value
    const authHeader = `Authorization: Bot ${botToken}`;
    const payloadJson = '{"content":"🎨 图片已生成！"}';

    const curlCmd = `curl --socks5 127.0.0.1:7890 -X POST -H "${authHeader}" -F file=@${imagePath} -F payload_json='${payloadJson}' https://discord.com/api/v10/channels/${channelId}/messages`;

    console.log('[Discord] Uploading image via curl...');
    const result = execSync(curlCmd, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
      encoding: 'utf-8',
    });

    console.log(
      '[Discord] Image sent via curl, response:',
      result.slice(0, 200),
    );
    return true;
  } catch (err: any) {
    console.log('[Discord] curl upload failed:', err.message);
    return false;
  }
}

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;
  // Track the user to reply to for each channel (most recent mention)
  private pendingReplyTo: Map<string, { id: string; name: string }> = new Map();

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    await setupProxy();

    const proxyDispatcher = createProxyDispatcher();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      rest: {
        agent: proxyDispatcher,
        timeout: 60000, // 60 second timeout for REST requests
      } as any,
    });

    // Also log raw events for debugging
    this.client.on('raw', (packet: any) => {
      if (packet.t === 'MESSAGE_CREATE') {
        console.log(
          '[Discord Raw MESSAGE_CREATE]:',
          packet.d.channel_id,
          packet.d.author?.username,
          packet.d.content?.slice(0, 30),
        );
      }
    });

    // Also log ALL raw events for debugging
    this.client.on('raw', (packet: any) => {
      console.log('[Discord Raw Event]:', packet.t, packet.d?.channel_id);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      console.log(
        '[Discord] Message received:',
        message.content.slice(0, 50),
        'from',
        message.author.username,
        'in channel',
        message.channelId,
      );

      // Check if bot is mentioned
      const botId = this.client?.user?.id || '';
      const isBotMentioned =
        message.mentions.users.has(botId) ||
        message.content.includes(`<@${botId}>`) ||
        message.content.includes(`<@!${botId}>`);

      // Check if this is a DM (no guild)
      const isDM = message.guild === null;

      // Ignore bot messages (including own) UNLESS the bot is mentioned
      // Also ignore user messages unless the bot is mentioned or it's a DM
      if (message.author.bot && !isBotMentioned) {
        console.log('[Discord] Ignoring bot message - not mentioned');
        return;
      }

      // For user messages: only process if glmclaw is mentioned or it's a DM
      if (!message.author.bot && !isBotMentioned && !isDM) {
        console.log('[Discord] Ignoring user message - glmclaw not mentioned and not a DM');
        return;
      }

      // Store sender info for reply tracking (for @mentioning users in responses)
      if (!message.author.bot && isBotMentioned) {
        const senderId = message.author.id;
        const senderDisplayName =
          message.member?.displayName ||
          message.author.displayName ||
          message.author.username;
        this.pendingReplyTo.set(message.channelId, { id: senderId, name: senderDisplayName });
      }

      // Auto-reply: only when "图片已生成" is detected AND glmclaw is mentioned
      // This creates automatic chain: jmclaw generates image -> mentions glmclaw -> glmclaw generates next prompt
      const myBotId = this.client?.user?.id || '';
      if (
        message.author.bot &&
        message.author.id !== myBotId &&
        message.content.includes('图片已生成') &&
        isBotMentioned  // Only trigger if glmclaw is mentioned
      ) {
        console.log('[Discord] Detected "图片已生成" from bot (glmclaw mentioned), generating next prompt...');

        // Extract mentioned users from jmclaw's message (to @ them in our reply)
        // Discord mentions look like <@USER_ID> or <@!USER_ID>
        const mentionedUsers: string[] = [];
        const mentionRegex = /<@!?(\d+)>/g;
        let match;
        while ((match = mentionRegex.exec(message.content)) !== null) {
          const mentionedId = match[1];
          // Skip if it's glmclaw itself
          if (mentionedId !== myBotId) {
            mentionedUsers.push(`<@${mentionedId}>`);
          }
        }

        // Generate next prompt - mix of random generation and presets for diversity
        let nextPrompt: string;
        if (Math.random() > 0.3) {
          // 70% chance: use random generation for more variety
          nextPrompt = generatePrompt(ADD_OPTIMIZE);
        } else {
          // 30% chance: use preset prompt
          nextPrompt = presetPrompts[Math.floor(Math.random() * presetPrompts.length)];
          // Presets already include --optimize, no need to add again
        }

        // Build the reply: @mention original users + @jmclaw + prompt
        const mentionPrefix = mentionedUsers.length > 0 ? `${mentionedUsers.join(' ')} ` : '';
        const finalPrompt = `${mentionPrefix}@jmclaw#1682 生成图片：${nextPrompt}`;

        // Send the next prompt
        try {
          const channel = await this.client!.channels.fetch(message.channelId);
          if (channel && 'send' in channel) {
            await (channel as TextChannel).send(finalPrompt);
            console.log('[Discord] Next prompt sent:', finalPrompt.slice(0, 80));
          }
        } catch (err) {
          console.error('[Discord] Failed to send next prompt:', err);
        }
        return;
      }

      // Check if this is an image generation request
      // The agent will handle prompt optimization and ComfyUI generation
      const isImageGen = isImageGenerationRequest(message.content);
      if (isImageGen) {
        console.log(
          '[Discord] Image generation request detected, forwarding to agent',
        );
      }

      // Forward message to agent - agent handles image generation including prompt optimization
      const channelId = message.channelId;
      const chatJid = `dc:${channelId}`;
      console.log('[Discord] chatJid:', chatJid);
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      // Determine chat name
      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate Discord @bot mentions into TRIGGER_PATTERN format.
      // Discord mentions look like <@botUserId> — these won't match
      // TRIGGER_PATTERN (e.g., ^@Andy\b), so we prepend the trigger
      // when the bot is @mentioned.
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`);

        if (isBotMentioned) {
          // Strip the <@botId> mention to avoid visual clutter
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          // Prepend trigger if not already present
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Handle attachments — download text content and include it in the message
      console.log(
        '[Discord] Attachments:',
        message.attachments.size,
        [...message.attachments.values()].map((a) => ({
          name: a.name,
          type: a.contentType,
          url: a.url,
        })),
      );
      if (message.attachments.size > 0) {
        for (const att of message.attachments.values()) {
          const contentType = att.contentType || '';
          const name = att.name || 'file';

          // For text files, download and include the content
          if (
            contentType.startsWith('text/') ||
            name.endsWith('.txt') ||
            name.endsWith('.md') ||
            name.endsWith('.json') ||
            name.endsWith('.log') ||
            name.endsWith('.csv') ||
            name.endsWith('.xml') ||
            name.endsWith('.html') ||
            name.endsWith('.css') ||
            name.endsWith('.js') ||
            name.endsWith('.ts')
          ) {
            console.log(
              '[Discord] Downloading attachment:',
              name,
              att.url,
              'proxyURL:',
              att.proxyURL,
            );
            try {
              // Discord attachments are public - use curl which handles SOCKS5 properly
              const downloadUrl = att.proxyURL || att.url;
              const { execSync } = require('child_process');
              const curlCmd = `curl -s --proxy socks5://127.0.0.1:7890 "${downloadUrl}"`;
              const textContent = execSync(curlCmd, {
                maxBuffer: 10240 * 2,
              }).toString();
              // Include up to 10KB of text content
              const truncated =
                textContent.length > 10240
                  ? textContent.slice(0, 10240) +
                    '\n[...content truncated, file too long...]'
                  : textContent;
              content = `${content}\n\n[File: ${name}]\n\`\`\`\n${truncated}\n\`\`\``;
            } catch (err) {
              console.log('[Discord] Download error:', err);
              content = `${content}\n[File: ${name} - could not read content]`;
            }
          } else if (contentType.startsWith('image/')) {
            content = `${content}\n[Image: ${name}]`;
          } else if (contentType.startsWith('video/')) {
            content = `${content}\n[Video: ${name}]`;
          } else if (contentType.startsWith('audio/')) {
            content = `${content}\n[Audio: ${name}]`;
          } else {
            content = `${content}\n[File: ${name}]`;
          }
        }
      }

      // Handle reply context — include who the user is replying to
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

      // Store chat metadata for discovery
      const isGroup = message.guild !== null;
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'discord',
        isGroup,
      );

      // Only deliver full message for registered groups
      const registeredGroups = this.opts.registeredGroups();
      console.log(
        '[Discord] Registered groups:',
        Object.keys(registeredGroups),
      );
      const group = registeredGroups[chatJid];
      if (!group) {
        console.log(
          '[Discord] Message from unregistered channel:',
          chatJid,
          chatName,
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    // Handle errors gracefully
    // Debug: track ALL events
    this.client.on(Events.Debug, (msg) => {
      console.log('[Discord Debug]:', msg.slice(0, 150));
    });

    this.client.on(Events.Warn, (msg) => {
      console.log('[Discord Warn]:', msg);
    });

    this.client.on(Events.Error, (err) => {
      console.log('[Discord Error]:', err.message);
      logger.error({ err: err.message }, 'Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Use /chatid command or check channel IDs in Discord settings\n`,
        );
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      // Get the user to reply to and prepend @mention
      const replyTo = this.pendingReplyTo.get(channelId);
      let mentionPrefix = '';
      if (replyTo) {
        mentionPrefix = `<@${replyTo.id}> `;
        // Clean up after sending
        this.pendingReplyTo.delete(channelId);
      }

      // Check if text contains an image path from the agent
      // Match /workspace/group/images/xxx.jpg format and convert to host path
      const imagePathMatch = text.match(/\/workspace\/group\/images\/([^\/\s\n]+\.(?:jpg|png|jpeg))/);
      let imagePath: string | null = null;
      if (imagePathMatch) {
        // Get group folder from registered groups (jid -> folder mapping)
        const registeredGroups = this.opts.registeredGroups();
        const registered = registeredGroups[jid];
        const folder = registered?.folder || null;
        if (folder) {
          imagePath = path.join(GROUPS_DIR, folder, 'images', imagePathMatch[1]);
        }
      }

      if (imagePath && existsSync(imagePath)) {
        console.log('[Discord] Sending image:', imagePath);
        // Send image via curl with SOCKS5 proxy
        const success = await this.sendImageToChannel(imagePath, channelId);
        if (success) {
          console.log('[Discord] Image sent successfully');
        }
        // Also send the text message (may contain description)
      }

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      const fullText = mentionPrefix + text;
      if (fullText.length <= MAX_LENGTH) {
        await textChannel.send(fullText);
      } else {
        // If mention prefix causes overflow, skip it
        if (text.length <= MAX_LENGTH) {
          await textChannel.send(text);
        } else {
          for (let i = 0; i < text.length; i += MAX_LENGTH) {
            await textChannel.send(text.slice(i, i + MAX_LENGTH));
          }
        }
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  private async sendImageToChannel(
    imagePath: string,
    channelId: string,
  ): Promise<boolean> {
    try {
      const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
      const botToken =
        process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN;

      if (!botToken) {
        console.log('[Discord] No bot token found');
        return false;
      }

      const authHeader = `Authorization: Bot ${botToken}`;
      // Image caption should NOT include mention - mention will be in the follow-up text message
      const imageMessage = '🎨 图片已生成！';
      const payloadJson = JSON.stringify({ content: imageMessage });
      const curlCmd = `curl --socks5 127.0.0.1:7890 -X POST -H "${authHeader}" -F file=@${imagePath} -F 'payload_json=${payloadJson}' https://discord.com/api/v10/channels/${channelId}/messages`;

      console.log('[Discord] Uploading image via curl...');
      const result = execSync(curlCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
        encoding: 'utf-8',
      });

      console.log(
        '[Discord] Image sent via curl, response:',
        result.slice(0, 200),
      );
      return true;
    } catch (err: any) {
      console.log('[Discord] curl upload failed:', err.message);
      return false;
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}

registerChannel('discord', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const token =
    process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Discord: DISCORD_BOT_TOKEN not set');
    return null;
  }
  return new DiscordChannel(token, opts);
});
