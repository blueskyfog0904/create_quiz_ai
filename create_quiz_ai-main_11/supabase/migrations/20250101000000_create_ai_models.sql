-- Create ai_models table for managing AI model names
create table public.ai_models (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  provider text not null check (provider in ('openai', 'gemini')),
  display_order integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(name, provider)
);

-- Enable RLS
alter table public.ai_models enable row level security;

-- RLS Policies
create policy "AI models are viewable by everyone" on public.ai_models
  for select using (true);

create policy "Admins can manage AI models" on public.ai_models
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Insert default models
insert into public.ai_models (name, provider, display_order) values
  ('gpt-4o', 'openai', 1),
  ('gpt-4-turbo', 'openai', 2),
  ('gpt-3.5-turbo', 'openai', 3),
  ('gemini-pro', 'gemini', 1),
  ('gemini-1.5-pro', 'gemini', 2);

-- Create index for faster queries
create index idx_ai_models_provider_order on public.ai_models(provider, display_order);
