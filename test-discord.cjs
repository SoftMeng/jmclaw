const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.on('ready', async () => {
  console.log('Bot ready:', client.user.tag);
  
  // Try to fetch the channel
  try {
    const channel = await client.channels.fetch('1484747023243677940');
    if (channel) {
      console.log('Channel found:', channel.name, 'type:', channel.type);
      const messages = await channel.messages.fetch({ limit: 5 });
      console.log('Recent messages:', messages.size);
      messages.forEach(m => {
        console.log(' -', m.author.username, ':', m.content.slice(0, 50));
      });
    } else {
      console.log('Channel not found!');
    }
  } catch (err) {
    console.log('Error fetching channel:', err.message);
  }
  
  setTimeout(() => {
    client.destroy();
    process.exit(0);
  }, 10000);
});

client.on('error', (err) => {
  console.log('Error:', err.message);
});

const token = process.env.DISCORD_BOT_TOKEN;
client.login(token);
