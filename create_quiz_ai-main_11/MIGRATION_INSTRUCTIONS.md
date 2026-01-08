# Database Migration Instructions

## Apply the Migration

The migration file has been created at:
`supabase/migrations/20251124114920_add_source_and_shared_question_id.sql`

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of the migration file:

```sql
-- Add source column to questions table
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ai_generated' CHECK (source IN ('ai_generated', 'admin_uploaded', 'from_community'));

-- Add shared_question_id column (for tracking original question from community)
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS shared_question_id UUID REFERENCES questions(id);

-- Update existing data to have 'ai_generated' as source
UPDATE questions SET source = 'ai_generated' WHERE source IS NULL;
```

4. Click "Run" to execute the migration

### Option 2: Using Supabase CLI (if linked)

If your project is linked to Supabase CLI:

```bash
npx supabase db push
```

### Verify Migration

After applying the migration, verify it was successful by checking:

1. The `questions` table should have two new columns:
   - `source` (VARCHAR(20), default: 'ai_generated')
   - `shared_question_id` (UUID, nullable)

2. All existing questions should have `source = 'ai_generated'`

## What Changed

### Database Schema
- Added `source` column to track question origin:
  - `ai_generated`: Questions created by AI
  - `admin_uploaded`: Questions uploaded by admins
  - `from_community`: Questions saved from community bank

- Added `shared_question_id` column to link copied questions to their originals

### New Features
1. **Admin Upload**: Admins can upload questions at `/admin/questions/upload`
2. **Community Bank**: Users can browse and save admin questions at `/community-bank`
3. **Source Filtering**: Question bank now has a source filter
4. **Source Tags**: Questions display source badges (AI생성문제 / 문제은행)

## Testing

After migration:

1. Test admin upload (requires `is_admin = true` in profiles table)
2. Test community bank browsing
3. Test saving questions from community bank
4. Test source filtering in question bank
5. Verify source badges display correctly

## Setting an Admin User

To set a user as admin, run this SQL in Supabase:

```sql
UPDATE profiles 
SET is_admin = true 
WHERE email = 'your-admin-email@example.com';
```

