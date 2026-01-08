-- Create system_settings table
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.system_settings enable row level security;

-- Policies (Same as system_prompts)
create policy "Admins can view system settings"
  on public.system_settings for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

create policy "Admins can update system settings"
  on public.system_settings for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Insert initial default settings
insert into public.system_settings (key, value, description) values
('ai_config', 
  '{
    "difficulty": {
      "high": "advanced / high school level (CEFR B2-C1)",
      "middle": "intermediate / middle school level (CEFR A2-B1)"
    },
    "counts": [1, 3, 5, 10]
  }'::jsonb, 
  'Configuration for AI Passage Generation including difficulty mappings and UI options.'
)
on conflict (key) do nothing;
