insert into public.ai_models (name, provider, display_order)
values
  ('gpt-4-turbo', 'openai', 90),
  ('gpt-3.5-turbo', 'openai', 91),
  ('gemini-pro', 'gemini', 90),
  ('gemini-1.5-pro', 'gemini', 91)
on conflict (name, provider) do update
set display_order = excluded.display_order,
    updated_at = now();
