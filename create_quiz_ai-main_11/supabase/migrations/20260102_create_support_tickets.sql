create table if not exists public.support_tickets (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone ('utc'::text, now()),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'pending'::text check (status in ('pending', 'in_progress', 'resolved', 'closed')),
  admin_response text null,
  responded_at timestamp with time zone null,
  constraint support_tickets_pkey primary key (id)
);

alter table public.support_tickets enable row level security;

create policy "Users can view their own tickets"
  on public.support_tickets for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tickets"
  on public.support_tickets for insert
  with check (auth.uid() = user_id);
