insert into public.system_settings (
  key,
  value,
  description
)
values (
  'header_navigation',
  '{
    "logoText": "AI영어문제팩토리",
    "items": [
      {
        "id": "menu-generate",
        "title": "AI문제생성",
        "href": "/generate",
        "children": []
      },
      {
        "id": "menu-bank",
        "title": "문제은행",
        "href": "/bank",
        "children": []
      },
      {
        "id": "menu-pricing",
        "title": "요금제",
        "href": "/pricing",
        "children": []
      }
    ]
  }'::jsonb,
  'Header navigation configuration including logo text and up to 2-depth menu items.'
)
on conflict (key) do nothing;
