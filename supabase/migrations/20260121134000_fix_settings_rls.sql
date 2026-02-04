-- Allow admin to insert/update any system settings
-- Or specifically allow the new keys if strict

-- First ensure the table allows inserts for everyone if they are admin, or RLS policy specifically
-- The error "new row violates row-level security policy" suggests strict RLS.

-- Check existing policies (optional, but safely adding a comprehensive one for admin is usually the fix)
-- Assuming 'is_admin' check is handled via application logic or a policy using a custom claim or profile lookup.

-- Policy for INSERT/UPDATE for admins on system_settings
CREATE POLICY "Enable insert for admins" ON "public"."system_settings"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  )
);

CREATE POLICY "Enable update for admins" ON "public"."system_settings"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  )
);
