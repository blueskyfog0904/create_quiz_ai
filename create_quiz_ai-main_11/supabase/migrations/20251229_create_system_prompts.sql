-- Create system_prompts table
create table if not exists public.system_prompts (
  key text primary key,
  description text,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.system_prompts enable row level security;

-- Policies
create policy "Admins can view system prompts"
  on public.system_prompts for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

create policy "Admins can update system prompts"
  on public.system_prompts for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

create policy "Admins can insert system prompts"
  on public.system_prompts for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Insert initial default prompts
insert into public.system_prompts (key, description, content) values
('ocr_pdf_extraction', 'Prompt for extracting text from PDF/Images via Gemini', 'Extract the text from this file. Return a JSON object with keys: title_en (if available, otherwise generate a suitable English title), title_ko (korean title if available, otherwise translate title_en), content (the full English text of the passage), content_translation (Korean translation of the content). Response must be valid JSON.'),
('ai_passage_generation', 'Prompt for generating new English passages via AI', 'Generate a reading passage suitable for a {difficulty} level Korean high school English exam. The topic should be related to {subCategory} within the field of {mainCategory}. Length should be approximately 150-200 words. Return a JSON object with: title_en, title_ko, content, content_translation.')
on conflict (key) do nothing;
