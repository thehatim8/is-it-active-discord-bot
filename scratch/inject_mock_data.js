import { createClient } from '@supabase/supabase-js';
import { config, validateConfig } from '../config.js';

// 1. Validate config first
if (!validateConfig()) {
  process.exit(1);
}

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

// 2. Get Guild ID from command line arguments
const guildId = process.argv[2];

if (!guildId) {
  console.error('\n❌ ERROR: Please provide a target Discord Guild (Server) ID to seed mock data.');
  console.error('Usage: npm run seed <guild_id>');
  console.error('Example: npm run seed 1499194917640208514\n');
  process.exit(1);
}

console.log(`\n🌱 Starting mock data generation for Guild ID: ${guildId}...`);

// Mock Assets
const mockUsers = [
  '830294821039849201', // Alice
  '920394821039849202', // Bob
  '120394821039849203', // Charlie
  '420394821039849204', // Dave
  '520394821039849205', // Eve
  '620394821039849206', // Frank
  '720394821039849207', // Grace
  '320394821039849208', // Heidi
  '220394821039849209', // Ivan
  '120394821039849210'  // Judy
];

const textChannels = [
  '1499194917640208520', // #general
  '1499194917640208521', // #gaming
  '1499194917640208522'  // #memes
];

const voiceChannels = [
  '1499194917640208530', // Lounge 🔊
  '1499194917640208531'  // Squad Up 🔊
];

// Helper to get random item
const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Helper to generate a date in the last N days with a skewed hour distribution
// Skews towards peak hours: 6:00 PM to 10:00 PM (18:00 to 22:00)
function generateSkewedDate(daysAgoLimit = 14) {
  const date = new Date();
  
  // Random day in the range
  const daysAgo = Math.floor(Math.random() * daysAgoLimit);
  date.setDate(date.getDate() - daysAgo);

  // Set hour based on a probability distribution to simulate real peak times
  let hour;
  const randVal = Math.random();
  if (randVal < 0.6) {
    // 60% chance of being in peak hours (18 to 22)
    hour = 18 + Math.floor(Math.random() * 5);
  } else if (randVal < 0.85) {
    // 25% chance of being in normal waking hours (09 to 17)
    hour = 9 + Math.floor(Math.random() * 9);
  } else {
    // 15% chance of being in off-peak midnight/early hours (23 to 08)
    hour = (Math.random() < 0.5) ? 23 : Math.floor(Math.random() * 9);
  }

  date.setHours(hour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
  return date;
}

(async () => {
  try {
    // 1. Seed Text Messages (approx 1200 messages)
    console.log('💬 Seeding mock text messages...');
    const messageRows = [];
    
    for (let i = 0; i < 1200; i++) {
      const user = randItem(mockUsers);
      const channel = randItem(textChannels);
      const timestamp = generateSkewedDate(14);
      
      messageRows.push({
        guild_id: guildId,
        channel_id: channel,
        user_id: user,
        created_at: timestamp.toISOString()
      });
    }

    // Insert message history in chunks to optimize network performance
    const chunkSize = 200;
    for (let i = 0; i < messageRows.length; i += chunkSize) {
      const chunk = messageRows.slice(i, i + chunkSize);
      const { error } = await supabase.from('messages').insert(chunk);
      if (error) throw error;
    }
    console.log(`✅ Logged ${messageRows.length} mock messages!`);

    // 2. Seed Voice Sessions (approx 150 sessions)
    console.log('🔊 Seeding mock voice sessions...');
    const voiceRows = [];

    for (let i = 0; i < 150; i++) {
      const user = randItem(mockUsers);
      const channel = randItem(voiceChannels);
      
      // Voice sessions also skew towards peak times
      const joinTime = generateSkewedDate(14);
      
      // Random duration from 10 minutes to 3.5 hours
      const durationMs = (10 + Math.floor(Math.random() * 200)) * 60 * 1000; 
      const leaveTime = new Date(joinTime.getTime() + durationMs);

      voiceRows.push({
        guild_id: guildId,
        channel_id: channel,
        user_id: user,
        join_time: joinTime.toISOString(),
        leave_time: leaveTime.toISOString()
      });
    }

    for (let i = 0; i < voiceRows.length; i += chunkSize) {
      const chunk = voiceRows.slice(i, i + chunkSize);
      const { error } = await supabase.from('voice_sessions').insert(chunk);
      if (error) throw error;
    }
    console.log(`✅ Logged ${voiceRows.length} mock voice sessions!`);

    // 3. Seed Server Growth Member Events
    console.log('👥 Seeding mock growth logs...');
    const memberRows = [];
    
    // Simulate 30 joins and 5 leaves in last 30 days
    for (let i = 0; i < 35; i++) {
      const user = `8302948210398${Math.floor(100000 + Math.random() * 900000)}`;
      const eventType = (i < 30) ? 'join' : 'leave';
      const timestamp = generateSkewedDate(30);

      memberRows.push({
        guild_id: guildId,
        user_id: user,
        event_type: eventType,
        created_at: timestamp.toISOString()
      });
    }

    const { error: memberErr } = await supabase.from('member_events').insert(memberRows);
    if (memberErr) throw memberErr;
    console.log(`✅ Logged ${memberRows.length} member join/leave logs!`);

    console.log('\n🌟 DATABASE SEEDING COMPLETED SUCCESSFULY!');
    console.log('You can now boot up the bot and immediately view realistic server analytics!\n');

  } catch (err) {
    console.error('❌ Error during mock data seeding:', err.message);
  }
})();
