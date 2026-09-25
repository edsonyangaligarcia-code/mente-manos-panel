-- Mente & Manos Dashboard — Supabase schema
-- Ejecutar completo en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_date date not null,
  sale_time time,
  campaign text not null,
  product text,
  upsell boolean not null default false,
  offer_type text not null default 'OPCIÓN / DIRECTA',
  amount numeric(12,2) not null check (amount >= 0),
  original_price numeric(12,2),
  followup_stage text not null default 'Directo',
  discount numeric(12,2),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.ad_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_date date not null,
  campaign text not null,
  conversations integer not null default 0 check (conversations >= 0),
  ad_spend numeric(12,2) not null default 0 check (ad_spend >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, ad_date, campaign)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ad_surcharge_pct numeric(8,2) not null default 18,
  monthly_goal numeric(12,2) not null default 10000,
  chatgpt_cost numeric(12,2) not null default 0,
  active_campaigns jsonb not null default '["ING 1","ING 3 y 4","ING 7"]'::jsonb,
  base_prices jsonb not null default '{"ING 1":9.9,"ING 3 y 4":12.9,"ING 7":12.9}'::jsonb,
  combo_price numeric(12,2) not null default 15.9,
  vip_price numeric(12,2) not null default 29.9,
  updated_at timestamptz not null default now()
);

create index if not exists sales_user_date_idx on public.sales(user_id, sale_date);
create index if not exists sales_user_campaign_idx on public.sales(user_id, campaign);
create index if not exists ad_daily_user_date_idx on public.ad_daily(user_id, ad_date);

alter table public.sales enable row level security;
alter table public.ad_daily enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "sales_select_own" on public.sales;
drop policy if exists "sales_insert_own" on public.sales;
drop policy if exists "sales_update_own" on public.sales;
drop policy if exists "sales_delete_own" on public.sales;
create policy "sales_select_own" on public.sales for select using (auth.uid() = user_id);
create policy "sales_insert_own" on public.sales for insert with check (auth.uid() = user_id);
create policy "sales_update_own" on public.sales for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sales_delete_own" on public.sales for delete using (auth.uid() = user_id);

drop policy if exists "ad_select_own" on public.ad_daily;
drop policy if exists "ad_insert_own" on public.ad_daily;
drop policy if exists "ad_update_own" on public.ad_daily;
drop policy if exists "ad_delete_own" on public.ad_daily;
create policy "ad_select_own" on public.ad_daily for select using (auth.uid() = user_id);
create policy "ad_insert_own" on public.ad_daily for insert with check (auth.uid() = user_id);
create policy "ad_update_own" on public.ad_daily for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ad_delete_own" on public.ad_daily for delete using (auth.uid() = user_id);

drop policy if exists "settings_select_own" on public.user_settings;
drop policy if exists "settings_insert_own" on public.user_settings;
drop policy if exists "settings_update_own" on public.user_settings;
create policy "settings_select_own" on public.user_settings for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- Data API privileges
-- Required on projects where new tables are not exposed automatically.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.sales to authenticated;
grant select, insert, update, delete on table public.ad_daily to authenticated;
grant select, insert, update, delete on table public.user_settings to authenticated;

-- Anonymous visitors do not need access to business data.
revoke all on table public.sales from anon;
revoke all on table public.ad_daily from anon;
revoke all on table public.user_settings from anon;
