import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role key needed for DDL

const supabase = createClient(supabaseUrl, supabaseKey)

async function runMigration(filePath: string) {
  const sql = fs.readFileSync(filePath, 'utf-8')
  
  console.log(`Running migration: ${path.basename(filePath)}`)
  console.log('SQL:', sql)
  
  const { data, error } = await supabase.rpc('exec_sql', { sql })
  
  if (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }
  
  console.log('Migration completed successfully!')
}

// Run specific migration
const migrationFile = process.argv[2] || 'supabase/migrations/20251124155428_add_admin_provider.sql'
runMigration(migrationFile)

