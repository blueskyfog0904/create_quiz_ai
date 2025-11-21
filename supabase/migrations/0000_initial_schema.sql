-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Create profiles table
create table public.profiles (
  id uuid references auth.users(id) on delete cascade not null primary key,
  email text,
  name text,
  phone text,
  birthdate date,
  organization text,
  gender text,
  address text,
  provider text default 'email',
  kakao_id text,
  kakao_email text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create problem_types table
create table public.problem_types (
  id uuid default uuid_generate_v4() primary key,
  type_name text not null,
  description text,
  provider text not null check (provider in ('openai', 'gemini')),
  model_name text not null,
  prompt_template text not null,
  output_format text,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Create questions table
create table public.questions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  question_text text not null,
  choices jsonb not null, -- Array of { label: string, text: string }
  answer text not null,
  explanation text,
  passage_text text,
  difficulty text, -- 'Low', 'Medium', 'High'
  grade_level text, -- 'Middle1', 'High3', etc.
  problem_type_id uuid references public.problem_types(id) on delete set null,
  raw_ai_response text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Create exam_papers table
create table public.exam_papers (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  paper_title text not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Create exam_paper_items table (Junction table)
create table public.exam_paper_items (
  id uuid default uuid_generate_v4() primary key,
  exam_paper_id uuid references public.exam_papers(id) on delete cascade not null,
  question_id uuid references public.questions(id) on delete cascade not null,
  number integer not null,
  order_index integer not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.problem_types enable row level security;
alter table public.questions enable row level security;
alter table public.exam_papers enable row level security;
alter table public.exam_paper_items enable row level security;

-- RLS Policies

-- Profiles
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Problem Types
create policy "Problem types are viewable by everyone" on public.problem_types
  for select using (true);

create policy "Admins can insert/update problem types" on public.problem_types
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Questions
create policy "Users can view own questions" on public.questions
  for select using (auth.uid() = user_id);

create policy "Users can insert own questions" on public.questions
  for insert with check (auth.uid() = user_id);

create policy "Users can update own questions" on public.questions
  for update using (auth.uid() = user_id);

create policy "Users can delete own questions" on public.questions
  for delete using (auth.uid() = user_id);

-- Exam Papers
create policy "Users can view own exam papers" on public.exam_papers
  for select using (auth.uid() = user_id);

create policy "Users can insert own exam papers" on public.exam_papers
  for insert with check (auth.uid() = user_id);

create policy "Users can update own exam papers" on public.exam_papers
  for update using (auth.uid() = user_id);

create policy "Users can delete own exam papers" on public.exam_papers
  for delete using (auth.uid() = user_id);

-- Exam Paper Items
create policy "Users can view items of own papers" on public.exam_paper_items
  for select using (
    exists (
      select 1 from public.exam_papers
      where exam_papers.id = exam_paper_items.exam_paper_id
      and exam_papers.user_id = auth.uid()
    )
  );

create policy "Users can insert items to own papers" on public.exam_paper_items
  for insert with check (
    exists (
      select 1 from public.exam_papers
      where exam_papers.id = exam_paper_items.exam_paper_id
      and exam_papers.user_id = auth.uid()
    )
  );

create policy "Users can delete items from own papers" on public.exam_paper_items
  for delete using (
    exists (
      select 1 from public.exam_papers
      where exam_papers.id = exam_paper_items.exam_paper_id
      and exam_papers.user_id = auth.uid()
    )
  );

-- Functions and Triggers

-- Function to handle new user creation
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user creation
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

