-- Create passages table
create table if not exists public.passages (
    id uuid not null default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    content text not null,
    title_en text,
    title_ko text,
    content_translation text,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now()),
    constraint passages_pkey primary key (id)
);

-- Add RLS policies for passages
alter table public.passages enable row level security;

create policy "Users can view their own passages"
    on public.passages for select
    using (auth.uid() = user_id);

create policy "Users can insert their own passages"
    on public.passages for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own passages"
    on public.passages for update
    using (auth.uid() = user_id);

create policy "Users can delete their own passages"
    on public.passages for delete
    using (auth.uid() = user_id);

-- Add passage_id to questions table
alter table public.questions 
add column if not exists passage_id uuid references public.passages(id) on delete set null;

-- Add index for performance
create index if not exists idx_questions_passage_id on public.questions(passage_id);
create index if not exists idx_passages_user_id on public.passages(user_id);
