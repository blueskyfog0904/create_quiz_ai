-- Create providers table for managing AI providers
create table public.providers (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  display_name text not null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.providers enable row level security;

-- RLS Policies
create policy "Providers are viewable by everyone" on public.providers
  for select using (is_active = true);

create policy "Admins can manage providers" on public.providers
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Insert default providers
insert into public.providers (name, display_name, display_order, is_active) values
  ('openai', 'OpenAI', 1, true),
  ('gemini', 'Gemini', 2, true);

-- Create index for faster queries
create index idx_providers_order on public.providers(display_order);

-- Update ai_models table to reference providers
-- Note: This is a soft migration - we keep the check constraint but also allow dynamic providers
-- For now, we'll keep the check constraint but make it more flexible in the future if needed
