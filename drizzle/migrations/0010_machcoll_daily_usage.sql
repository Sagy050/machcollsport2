create table public.machcoll_daily_usage (
  device_key text not null,
  usage_day date not null,
  used_at timestamptz not null default now(),
  primary key (device_key, usage_day)
);

grant all on public.machcoll_daily_usage to service_role;
