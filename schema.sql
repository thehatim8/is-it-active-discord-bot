-- ====================================================================
-- "Is It Active?" Discord Bot Database Schema
-- Run this script in your Supabase SQL Editor.
-- ====================================================================

-- 1. Create Tables
create table if not exists messages (
  id bigint primary key generated always as identity,
  guild_id text not null,
  channel_id text not null,
  user_id text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists voice_sessions (
  id bigint primary key generated always as identity,
  guild_id text not null,
  channel_id text not null,
  user_id text not null,
  join_time timestamp with time zone not null default now(),
  leave_time timestamp with time zone
);

create table if not exists member_events (
  id bigint primary key generated always as identity,
  guild_id text not null,
  user_id text not null,
  event_type text not null, -- 'join' or 'leave'
  created_at timestamp with time zone not null default now()
);

create table if not exists guilds (
  guild_id text primary key,
  name text not null,
  icon_url text,
  member_count integer,
  owner_id text,
  bot_joined_at timestamp with time zone,
  last_seen_at timestamp with time zone not null default now(),
  bot_present boolean not null default true
);

create table if not exists bot_command_access (
  id bigint primary key generated always as identity,
  guild_id text not null,
  target_type text not null check (target_type in ('role', 'member')),
  target_id text not null,
  created_at timestamp with time zone not null default now(),
  unique (guild_id, target_type, target_id)
);

create table if not exists kick_deafen_settings (
  guild_id text primary key,
  enabled boolean not null default false,
  inactivity_seconds integer not null default 300 check (inactivity_seconds in (1, 60, 120, 300, 600, 1800)),
  whitelisted_role_id text,
  updated_at timestamp with time zone not null default now()
);

alter table if exists kick_deafen_settings
add column if not exists whitelisted_role_id text;

-- 2. Create Indexes for performance
create index if not exists idx_messages_guild_created on messages(guild_id, created_at);
create index if not exists idx_voice_guild_times on voice_sessions(guild_id, join_time, leave_time);
create index if not exists idx_member_guild_created on member_events(guild_id, created_at);
create index if not exists idx_guilds_present on guilds(bot_present);
create index if not exists idx_command_access_guild on bot_command_access(guild_id);

-- 3. Active Members Analytics RPC Function
create or replace function get_active_members(
  p_guild_id text,
  p_type text,
  p_days int default 7
)
returns table (
  user_id text,
  score bigint
)
language plpgsql
security definer
as $$
begin
  if p_type = 'text' then
    return query
    select m.user_id, count(*)::bigint as score
    from messages m
    where m.guild_id = p_guild_id
      and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval)
    group by m.user_id
    order by score desc
    limit 15;
  elsif p_type = 'voice' then
    return query
    select v.user_id, sum(extract(epoch from (coalesce(v.leave_time, now()) - v.join_time)))::bigint as score
    from voice_sessions v
    where v.guild_id = p_guild_id
      and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval)
    group by v.user_id
    order by score desc
    limit 15;
  else -- 'combined' or other
    return query
    select t.user_id, sum(t.val)::bigint as score
    from (
      select m.user_id, count(*) * 10 as val -- 10 points per message
      from messages m
      where m.guild_id = p_guild_id
        and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval)
      group by m.user_id
      union all
      select v.user_id, sum(extract(epoch from (coalesce(v.leave_time, now()) - v.join_time))) / 60 * 5 as val -- 5 points per voice minute
      from voice_sessions v
      where v.guild_id = p_guild_id
        and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval)
      group by v.user_id
    ) t
    group by t.user_id
    order by score desc
    limit 15;
  end if;
end;
$$;

-- 4. Active Channels Analytics RPC Function
create or replace function get_active_channels(
  p_guild_id text,
  p_days int default 7
)
returns table (
  channel_id text,
  message_count bigint,
  peak_hour int
)
language plpgsql
security definer
as $$
begin
  return query
  with channel_counts as (
    select m.channel_id, count(*)::bigint as msg_count
    from messages m
    where m.guild_id = p_guild_id
      and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval)
    group by m.channel_id
  ),
  channel_hours as (
    select 
      m.channel_id, 
      extract(hour from m.created_at AT TIME ZONE 'UTC')::int as hr,
      count(*) as hr_count,
      row_number() over(partition by m.channel_id order by count(*) desc) as rn
    from messages m
    where m.guild_id = p_guild_id
      and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval)
    group by m.channel_id, extract(hour from m.created_at AT TIME ZONE 'UTC')
  )
  select 
    cc.channel_id, 
    cc.msg_count as message_count,
    coalesce(ch.hr, 0) as peak_hour
  from channel_counts cc
  left join channel_hours ch on cc.channel_id = ch.channel_id and ch.rn = 1
  order by cc.msg_count desc
  limit 15;
end;
$$;

-- 5. Active Voice Channels Analytics RPC Function
create or replace function get_active_voice(
  p_guild_id text,
  p_days int default 7
)
returns table (
  channel_id text,
  total_seconds bigint,
  peak_hour int
)
language plpgsql
security definer
as $$
begin
  return query
  with voice_counts as (
    select v.channel_id, sum(extract(epoch from (coalesce(v.leave_time, now()) - v.join_time)))::bigint as duration
    from voice_sessions v
    where v.guild_id = p_guild_id
      and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval)
    group by v.channel_id
  ),
  voice_hours as (
    select 
      v.channel_id, 
      extract(hour from v.join_time AT TIME ZONE 'UTC')::int as hr,
      count(*) as hr_count,
      row_number() over(partition by v.channel_id order by count(*) desc) as rn
    from voice_sessions v
    where v.guild_id = p_guild_id
      and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval)
    group by v.channel_id, extract(hour from v.join_time AT TIME ZONE 'UTC')
  )
  select 
    vc.channel_id, 
    vc.duration as total_seconds,
    coalesce(vh.hr, 0) as peak_hour
  from voice_counts vc
  left join voice_hours vh on vc.channel_id = vh.channel_id and vh.rn = 1
  order by vc.duration desc
  limit 15;
end;
$$;

-- 6. Peak Server Hours Analytics RPC Function
create or replace function get_peak_hours(
  p_guild_id text,
  p_days int default 7
)
returns table (
  hour_of_day int,
  message_count bigint,
  voice_join_count bigint
)
language plpgsql
security definer
as $$
begin
  return query
  with hours as (
    select generate_series(0, 23) as hr
  ),
  msg_hours as (
    select extract(hour from m.created_at AT TIME ZONE 'UTC')::int as hr, count(*) as count
    from messages m
    where m.guild_id = p_guild_id
      and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval)
    group by extract(hour from m.created_at AT TIME ZONE 'UTC')
  ),
  voice_hours as (
    select extract(hour from v.join_time AT TIME ZONE 'UTC')::int as hr, count(*) as count
    from voice_sessions v
    where v.guild_id = p_guild_id
      and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval)
    group by extract(hour from v.join_time AT TIME ZONE 'UTC')
  )
  select 
    h.hr as hour_of_day,
    coalesce(m.count, 0)::bigint as message_count,
    coalesce(v.count, 0)::bigint as voice_join_count
  from hours h
  left join msg_hours m on h.hr = m.hr
  left join voice_hours v on h.hr = v.hr
  order by h.hr;
end;
$$;

-- 7. Server Summary RPC Function
create or replace function get_server_summary(
  p_guild_id text,
  p_days int default 7
)
returns table (
  total_messages bigint,
  total_voice_seconds bigint,
  active_users bigint,
  server_peak_hour int
)
language plpgsql
security definer
as $$
declare
  v_total_msgs bigint;
  v_total_voice bigint;
  v_active_users bigint;
  v_peak_hour int;
begin
  -- 1. Count total messages
  select count(*) into v_total_msgs
  from messages m
  where m.guild_id = p_guild_id
    and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval);

  -- 2. Count total voice seconds
  select coalesce(sum(extract(epoch from (coalesce(v.leave_time, now()) - v.join_time))), 0)::bigint into v_total_voice
  from voice_sessions v
  where v.guild_id = p_guild_id
    and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval);

  -- 3. Active users (distinct users sending messages or joining voice)
  with active as (
    select m.user_id
    from messages m
    where m.guild_id = p_guild_id
      and (p_days = 0 or m.created_at >= now() - (p_days || ' days')::interval)
    union
    select v.user_id
    from voice_sessions v
    where v.guild_id = p_guild_id
      and (p_days = 0 or v.join_time >= now() - (p_days || ' days')::interval)
  )
  select count(*) into v_active_users from active;

  -- 4. Find overall server peak hour (combine message and voice joins)
  with hourly_activity as (
    select extract(hour from created_at AT TIME ZONE 'UTC')::int as hr, count(*) as cnt
    from messages
    where guild_id = p_guild_id
      and (p_days = 0 or created_at >= now() - (p_days || ' days')::interval)
    group by extract(hour from created_at AT TIME ZONE 'UTC')
    union all
    select extract(hour from join_time AT TIME ZONE 'UTC')::int as hr, count(*) as cnt
    from voice_sessions
    where guild_id = p_guild_id
      and (p_days = 0 or join_time >= now() - (p_days || ' days')::interval)
    group by extract(hour from join_time AT TIME ZONE 'UTC')
  ),
  aggregated_hourly as (
    select hr, sum(cnt) as total_cnt
    from hourly_activity
    group by hr
    order by total_cnt desc
    limit 1
  )
  select coalesce((select hr from aggregated_hourly), 0) into v_peak_hour;

  return query
  select v_total_msgs, v_total_voice, v_active_users, v_peak_hour;
end;
$$;
