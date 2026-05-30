import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS } from './utils/kickDeafen.js';

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

function getCutoffIso(days) {
  if (!days || days <= 0) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString();
}

function chunkArray(values, size = 100) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchRowsInChunks({ table, columns, guildId, idColumn, ids, timeColumn, days, startIso = null, endIso = null }) {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const cutoffIso = startIso ? null : getCutoffIso(days);
  const rows = [];
  const pageSize = 1000;

  for (const idChunk of chunkArray(uniqueIds)) {
    let from = 0;

    while (true) {
      let query = supabase
        .from(table)
        .select(columns)
        .eq('guild_id', guildId)
        .in(idColumn, idChunk)
        .order('id', { ascending: true });

      if (startIso) {
        query = query.gte(timeColumn, startIso);
      } else if (cutoffIso) {
        query = query.gte(timeColumn, cutoffIso);
      }

      if (endIso) {
        query = query.lt(timeColumn, endIso);
      }

      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw error;

      rows.push(...(data || []));

      if (!data || data.length < pageSize) {
        break;
      }

      from += pageSize;
    }
  }

  return rows;
}

function getUtcHour(value) {
  const hour = new Date(value).getUTCHours();
  return Number.isFinite(hour) ? hour : 0;
}

function getPeakHour(hourCounts) {
  let peakHour = 0;
  let peakCount = -1;

  for (const [hour, count] of hourCounts.entries()) {
    if (count > peakCount) {
      peakHour = hour;
      peakCount = count;
    }
  }

  return peakHour;
}

function getVoiceDurationSeconds(session) {
  const join = new Date(session.join_time).getTime();
  const leave = session.leave_time ? new Date(session.leave_time).getTime() : Date.now();
  return Math.max(0, Math.floor((leave - join) / 1000));
}

function getUtcDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function fetchMemberEvents(guildId, { days = 7, startIso = null, endIso = null } = {}) {
  const cutoffIso = startIso ? null : getCutoffIso(days);
  const rows = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    let query = supabase
      .from('member_events')
      .select('event_type, created_at')
      .eq('guild_id', guildId)
      .order('id', { ascending: true });

    if (startIso) {
      query = query.gte('created_at', startIso);
    } else if (cutoffIso) {
      query = query.gte('created_at', cutoffIso);
    }

    if (endIso) {
      query = query.lt('created_at', endIso);
    }

    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;

    rows.push(...(data || []));

    if (!data || data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

export const db = {
  /**
   * Log a new text message event
   */
  async logMessage(guildId, channelId, userId, timestamp = null) {
    try {
      const data = {
        guild_id: guildId,
        channel_id: channelId,
        user_id: userId,
      };
      if (timestamp) {
        data.created_at = new Date(timestamp).toISOString();
      }
      
      const { error } = await supabase.from('messages').insert(data);
      if (error) throw error;
    } catch (err) {
      console.error('Error logging message to Supabase:', err.message);
    }
  },

  /**
   * Bulk log messages (used for high-performance backfilling)
   */
  async logMessagesBatch(messages) {
    if (!messages || messages.length === 0) return 0;
    try {
      const { error } = await supabase.from('messages').insert(messages);
      if (error) throw error;
      return messages.length;
    } catch (err) {
      console.error(`Error bulk logging ${messages.length} messages:`, err.message);
      return 0;
    }
  },

  /**
   * Handle user joining a voice channel
   */
  async startVoiceSession(guildId, channelId, userId) {
    try {
      // 1. Close any hanging open voice sessions for this user in this server
      await this.endVoiceSession(guildId, userId);

      // 2. Start a new session
      const { error } = await supabase.from('voice_sessions').insert({
        guild_id: guildId,
        channel_id: channelId,
        user_id: userId,
        join_time: new Date().toISOString()
      });
      if (error) throw error;
    } catch (err) {
      console.error('Error starting voice session:', err.message);
    }
  },

  /**
   * Handle user leaving voice channels
   */
  async endVoiceSession(guildId, userId) {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('voice_sessions')
        .update({ leave_time: now })
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .is('leave_time', null);
        
      if (error) throw error;
    } catch (err) {
      console.error('Error ending voice session:', err.message);
    }
  },

  /**
   * Log member join/leave event
   */
  async logMemberEvent(guildId, userId, eventType) {
    try {
      const { error } = await supabase.from('member_events').insert({
        guild_id: guildId,
        user_id: userId,
        event_type: eventType,
      });
      if (error) throw error;
    } catch (err) {
      console.error(`Error logging member ${eventType}:`, err.message);
    }
  },

  /**
   * Register or refresh a guild where the bot is installed.
   */
  async upsertGuild(guild) {
    try {
      const { error } = await supabase
        .from('guilds')
        .upsert(
          {
            guild_id: guild.id,
            name: guild.name,
            icon_url: guild.iconURL({ extension: 'png', size: 128 }),
            member_count: guild.memberCount ?? null,
            owner_id: guild.ownerId ?? null,
            bot_joined_at: guild.joinedAt ? guild.joinedAt.toISOString() : null,
            last_seen_at: new Date().toISOString(),
            bot_present: true
          },
          { onConflict: 'guild_id' }
        );
      if (error) throw error;
    } catch (err) {
      console.error('Error upserting guild metadata:', err.message);
    }
  },

  /**
   * Mark a guild as no longer connected to the bot.
   */
  async markGuildUnavailable(guildId) {
    try {
      const { error } = await supabase
        .from('guilds')
        .update({
          bot_present: false,
          last_seen_at: new Date().toISOString()
        })
        .eq('guild_id', guildId);
      if (error) throw error;
    } catch (err) {
      console.error('Error marking guild unavailable:', err.message);
    }
  },

  /**
   * Get command access allowlist rules for a guild.
   */
  async getCommandAccessRules(guildId) {
    try {
      const { data, error } = await supabase
        .from('bot_command_access')
        .select('target_type, target_id')
        .eq('guild_id', guildId);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching bot command access rules:', err.message);
      return [];
    }
  },

  /**
   * Allow a role or member to use bot commands.
   */
  async addCommandAccessRule(guildId, targetType, targetId) {
    try {
      const { error } = await supabase
        .from('bot_command_access')
        .upsert(
          {
            guild_id: guildId,
            target_type: targetType,
            target_id: targetId
          },
          { onConflict: 'guild_id,target_type,target_id' }
        );
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error adding bot command access rule:', err.message);
      return false;
    }
  },

  /**
   * Remove a role or member from the bot command allowlist.
   */
  async removeCommandAccessRule(guildId, targetType, targetId) {
    try {
      const { error } = await supabase
        .from('bot_command_access')
        .delete()
        .eq('guild_id', guildId)
        .eq('target_type', targetType)
        .eq('target_id', targetId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error removing bot command access rule:', err.message);
      return false;
    }
  },

  /**
   * Clear all configured bot command access rules for a guild.
   */
  async clearCommandAccessRules(guildId) {
    try {
      const { error } = await supabase
        .from('bot_command_access')
        .delete()
        .eq('guild_id', guildId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error clearing bot command access rules:', err.message);
      return false;
    }
  },

  /**
   * Get automatic deafen disconnect settings for a guild.
   */
  async getKickDeafenSettings(guildId) {
    try {
      const { data, error } = await supabase
        .from('kick_deafen_settings')
        .select('enabled, inactivity_seconds')
        .eq('guild_id', guildId)
        .maybeSingle();
      if (error) throw error;

      return {
        enabled: data?.enabled ?? false,
        inactivitySeconds: Number(data?.inactivity_seconds || KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS)
      };
    } catch (err) {
      console.error('Error fetching kick-deafen settings:', err.message);
      return {
        enabled: false,
        inactivitySeconds: KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS
      };
    }
  },

  /**
   * Save automatic deafen disconnect settings for a guild.
   */
  async setKickDeafenSettings(guildId, { enabled = false, inactivitySeconds = KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS } = {}) {
    try {
      const seconds = Number(inactivitySeconds) || KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS;
      const { error } = await supabase
        .from('kick_deafen_settings')
        .upsert(
          {
            guild_id: guildId,
            enabled: Boolean(enabled),
            inactivity_seconds: seconds,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'guild_id' }
        );
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error saving kick-deafen settings:', err.message);
      return false;
    }
  },

  /**
   * Sync database voice states on startup to handle bot downtime.
   * activeStates is an array of objects: { guildId, channelId, userId }
   */
  async syncActiveVoiceStates(guildId, activeStates) {
    try {
      console.log(`🤖 Synchronizing voice states for guild ${guildId}...`);
      const now = new Date().toISOString();

      // 1. Get all currently open voice sessions in DB for this guild
      const { data: openSessions, error: fetchErr } = await supabase
        .from('voice_sessions')
        .select('id, user_id, channel_id')
        .eq('guild_id', guildId)
        .is('leave_time', null);

      if (fetchErr) throw fetchErr;

      const activeUserIds = new Set(activeStates.map(s => s.userId));
      const activeStateMap = new Map(activeStates.map(s => [s.userId, s.channelId]));

      // 2. End sessions for users who are no longer in voice or switched channels
      const sessionsToEnd = [];
      for (const session of openSessions || []) {
        const currentChannelId = activeStateMap.get(session.user_id);
        if (!currentChannelId || currentChannelId !== session.channel_id) {
          sessionsToEnd.push(session.id);
        }
      }

      if (sessionsToEnd.length > 0) {
        console.log(`Closing ${sessionsToEnd.length} hanging voice sessions...`);
        const { error: updateErr } = await supabase
          .from('voice_sessions')
          .update({ leave_time: now })
          .in('id', sessionsToEnd);
        if (updateErr) throw updateErr;
      }

      // 3. Start sessions for users currently in voice but missing open session
      const sessionsToStart = [];
      const openUserIds = new Set((openSessions || [])
        .filter(s => !sessionsToEnd.includes(s.id))
        .map(s => s.user_id));

      for (const state of activeStates) {
        if (!openUserIds.has(state.userId)) {
          sessionsToStart.push({
            guild_id: guildId,
            channel_id: state.channelId,
            user_id: state.userId,
            join_time: now
          });
        }
      }

      if (sessionsToStart.length > 0) {
        console.log(`Creating ${sessionsToStart.length} missing active voice sessions...`);
        const { error: insertErr } = await supabase
          .from('voice_sessions')
          .insert(sessionsToStart);
        if (insertErr) throw insertErr;
      }

      console.log('✅ Voice state synchronization complete!');
    } catch (err) {
      console.error('Error synchronizing voice states:', err.message);
    }
  },

  // ==================================================================
  // Analytical Database RPC Queries
  // ==================================================================

  /**
   * Get Server dashboard summary
   */
  async getDashboardSummary(guildId, days = 7) {
    try {
      const { data, error } = await supabase.rpc('get_server_summary', {
        p_guild_id: guildId,
        p_days: days
      });
      if (error) throw error;
      return data[0] || null;
    } catch (err) {
      console.error('Error fetching dashboard summary:', err.message);
      return null;
    }
  },

  /**
   * Get Leaderboard of active members
   */
  async getActiveMembersLeaderboard(guildId, type = 'combined', days = 7) {
    try {
      const { data, error } = await supabase.rpc('get_active_members', {
        p_guild_id: guildId,
        p_type: type,
        p_days: days
      });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching active members leaderboard:', err.message);
      return [];
    }
  },

  /**
   * Get leaderboard for only currently resolvable guild members.
   * This keeps stale or mock user IDs from appearing as "unknown" in Discord embeds.
   */
  async getActiveMembersLeaderboardForIds(guildId, type = 'combined', days = 7, userIds = [], limit = 15, { startIso = null, endIso = null } = {}) {
    try {
      const scoreByUser = new Map();

      if (type === 'text' || type === 'combined') {
        const messageRows = await fetchRowsInChunks({
          table: 'messages',
          columns: 'user_id, created_at',
          guildId,
          idColumn: 'user_id',
          ids: userIds,
          timeColumn: 'created_at',
          days,
          startIso,
          endIso
        });

        for (const row of messageRows) {
          const current = scoreByUser.get(row.user_id) || 0;
          const value = type === 'combined' ? 10 : 1;
          scoreByUser.set(row.user_id, current + value);
        }
      }

      if (type === 'voice' || type === 'combined') {
        const voiceRows = await fetchRowsInChunks({
          table: 'voice_sessions',
          columns: 'user_id, join_time, leave_time',
          guildId,
          idColumn: 'user_id',
          ids: userIds,
          timeColumn: 'join_time',
          days,
          startIso,
          endIso
        });

        for (const row of voiceRows) {
          const current = scoreByUser.get(row.user_id) || 0;
          const durationSeconds = getVoiceDurationSeconds(row);
          const value = type === 'combined' ? Math.floor((durationSeconds / 60) * 5) : durationSeconds;
          scoreByUser.set(row.user_id, current + value);
        }
      }

      return Array.from(scoreByUser.entries())
        .map(([user_id, score]) => ({ user_id, score }))
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (err) {
      console.error('Error fetching filtered active members leaderboard:', err.message);
      return [];
    }
  },

  /**
   * Get active text channels
   */
  async getActiveChannels(guildId, days = 7) {
    try {
      const { data, error } = await supabase.rpc('get_active_channels', {
        p_guild_id: guildId,
        p_days: days
      });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching active channels:', err.message);
      return [];
    }
  },

  /**
   * Get active text channels for only currently resolvable guild channels.
   */
  async getActiveChannelsForIds(guildId, channelIds = [], days = 7, limit = 15, { startIso = null, endIso = null } = {}) {
    try {
      const rows = await fetchRowsInChunks({
        table: 'messages',
        columns: 'channel_id, created_at',
        guildId,
        idColumn: 'channel_id',
        ids: channelIds,
        timeColumn: 'created_at',
        days,
        startIso,
        endIso
      });

      const statsByChannel = new Map();
      for (const row of rows) {
        const stats = statsByChannel.get(row.channel_id) || {
          channel_id: row.channel_id,
          message_count: 0,
          hourCounts: new Map()
        };
        const hour = getUtcHour(row.created_at);

        stats.message_count += 1;
        stats.hourCounts.set(hour, (stats.hourCounts.get(hour) || 0) + 1);
        statsByChannel.set(row.channel_id, stats);
      }

      return Array.from(statsByChannel.values())
        .map(stats => ({
          channel_id: stats.channel_id,
          message_count: stats.message_count,
          peak_hour: getPeakHour(stats.hourCounts)
        }))
        .sort((a, b) => b.message_count - a.message_count)
        .slice(0, limit);
    } catch (err) {
      console.error('Error fetching filtered active channels:', err.message);
      return [];
    }
  },

  /**
   * Get active voice channels
   */
  async getActiveVoiceChannels(guildId, days = 7) {
    try {
      const { data, error } = await supabase.rpc('get_active_voice', {
        p_guild_id: guildId,
        p_days: days
      });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching active voice channels:', err.message);
      return [];
    }
  },

  /**
   * Get active voice channels for only currently resolvable guild voice channels.
   */
  async getActiveVoiceChannelsForIds(guildId, channelIds = [], days = 7, limit = 15, { startIso = null, endIso = null } = {}) {
    try {
      const rows = await fetchRowsInChunks({
        table: 'voice_sessions',
        columns: 'channel_id, join_time, leave_time',
        guildId,
        idColumn: 'channel_id',
        ids: channelIds,
        timeColumn: 'join_time',
        days,
        startIso,
        endIso
      });

      const statsByChannel = new Map();
      for (const row of rows) {
        const stats = statsByChannel.get(row.channel_id) || {
          channel_id: row.channel_id,
          total_seconds: 0,
          hourCounts: new Map()
        };
        const hour = getUtcHour(row.join_time);

        stats.total_seconds += getVoiceDurationSeconds(row);
        stats.hourCounts.set(hour, (stats.hourCounts.get(hour) || 0) + 1);
        statsByChannel.set(row.channel_id, stats);
      }

      return Array.from(statsByChannel.values())
        .map(stats => ({
          channel_id: stats.channel_id,
          total_seconds: stats.total_seconds,
          peak_hour: getPeakHour(stats.hourCounts)
        }))
        .filter(row => row.total_seconds > 0)
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, limit);
    } catch (err) {
      console.error('Error fetching filtered active voice channels:', err.message);
      return [];
    }
  },

  /**
   * Get dashboard totals for currently resolvable guild channels.
   */
  async getServerHealthSummaryForIds(guildId, { textChannelIds = [], voiceChannelIds = [], days = 7, startIso = null, endIso = null } = {}) {
    try {
      const [messageRows, voiceRows] = await Promise.all([
        fetchRowsInChunks({
          table: 'messages',
          columns: 'user_id, created_at',
          guildId,
          idColumn: 'channel_id',
          ids: textChannelIds,
          timeColumn: 'created_at',
          days,
          startIso,
          endIso
        }),
        fetchRowsInChunks({
          table: 'voice_sessions',
          columns: 'user_id, join_time, leave_time',
          guildId,
          idColumn: 'channel_id',
          ids: voiceChannelIds,
          timeColumn: 'join_time',
          days,
          startIso,
          endIso
        })
      ]);

      const activeUsers = new Set();
      const hourCounts = new Map();
      let totalVoiceSeconds = 0;

      for (const row of messageRows) {
        activeUsers.add(row.user_id);
        const hour = getUtcHour(row.created_at);
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      }

      for (const row of voiceRows) {
        activeUsers.add(row.user_id);
        totalVoiceSeconds += getVoiceDurationSeconds(row);
        const hour = getUtcHour(row.join_time);
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      }

      return {
        total_messages: messageRows.length,
        total_voice_seconds: totalVoiceSeconds,
        active_users: activeUsers.size,
        server_peak_hour: getPeakHour(hourCounts)
      };
    } catch (err) {
      console.error('Error fetching filtered server health summary:', err.message);
      return null;
    }
  },

  /**
   * Get server growth analytics from join/leave events.
   */
  async getGrowthAnalytics(guildId, days = 7, { startIso = null, endIso = null } = {}) {
    try {
      const events = await fetchMemberEvents(guildId, { days, startIso, endIso });
      let joins = 0;
      let leaves = 0;
      const growthByWindow = new Map();

      for (const event of events) {
        const type = event.event_type;
        if (type === 'join') joins++;
        if (type === 'leave') leaves++;

        const date = getUtcDate(event.created_at);
        const hour = getUtcHour(event.created_at);
        const key = `${date}|${hour}`;
        const window = growthByWindow.get(key) || {
          date,
          hour,
          joins: 0,
          leaves: 0,
          net: 0
        };

        if (type === 'join') {
          window.joins++;
          window.net++;
        } else if (type === 'leave') {
          window.leaves++;
          window.net--;
        }

        growthByWindow.set(key, window);
      }

      const bestWindow = Array.from(growthByWindow.values())
        .sort((a, b) => (b.net - a.net) || (b.joins - a.joins) || (a.leaves - b.leaves))[0] || null;
      const retentionEstimate = joins > 0
        ? Math.max(0, Math.min(100, ((joins - leaves) / joins) * 100))
        : null;

      return {
        joins,
        leaves,
        net_growth: joins - leaves,
        retention_estimate: retentionEstimate,
        best_growth_date: bestWindow?.date || null,
        best_growth_hour: bestWindow?.hour ?? null,
        best_growth_net: bestWindow?.net || 0,
        best_growth_joins: bestWindow?.joins || 0,
        best_growth_leaves: bestWindow?.leaves || 0
      };
    } catch (err) {
      console.error('Error fetching growth analytics:', err.message);
      return {
        joins: 0,
        leaves: 0,
        net_growth: 0,
        retention_estimate: null,
        best_growth_date: null,
        best_growth_hour: null,
        best_growth_net: 0,
        best_growth_joins: 0,
        best_growth_leaves: 0
      };
    }
  },

  /**
   * Get hourly activity for currently resolvable guild channels.
   */
  async getHourlyPeakAnalysisForIds(guildId, textChannelIds = [], voiceChannelIds = [], days = 7) {
    try {
      const [messageRows, voiceRows] = await Promise.all([
        fetchRowsInChunks({
          table: 'messages',
          columns: 'created_at',
          guildId,
          idColumn: 'channel_id',
          ids: textChannelIds,
          timeColumn: 'created_at',
          days
        }),
        fetchRowsInChunks({
          table: 'voice_sessions',
          columns: 'join_time',
          guildId,
          idColumn: 'channel_id',
          ids: voiceChannelIds,
          timeColumn: 'join_time',
          days
        })
      ]);

      const hours = Array.from({ length: 24 }, (_, hour) => ({
        hour_of_day: hour,
        message_count: 0,
        voice_join_count: 0
      }));

      for (const row of messageRows) {
        hours[getUtcHour(row.created_at)].message_count++;
      }

      for (const row of voiceRows) {
        hours[getUtcHour(row.join_time)].voice_join_count++;
      }

      return hours;
    } catch (err) {
      console.error('Error fetching filtered hourly peak analysis:', err.message);
      return [];
    }
  },

  /**
   * Get peak hours analysis (24 rows, 0-23)
   */
  async getHourlyPeakAnalysis(guildId, days = 7) {
    try {
      const { data, error } = await supabase.rpc('get_peak_hours', {
        p_guild_id: guildId,
        p_days: days
      });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching hourly peak analysis:', err.message);
      return [];
    }
  }
};
