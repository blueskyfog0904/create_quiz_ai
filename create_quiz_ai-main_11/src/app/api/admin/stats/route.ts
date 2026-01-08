import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check admin authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get today's date boundaries
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()
    
    // Get this month's start
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const monthStartISO = monthStart.toISOString()

    // Parallel queries for better performance
    const [
      todaySignupsResult,
      monthSignupsResult,
      totalQuestionsResult,
      recentQuestionsResult,
      gradeLevelStatsResult,
      todayAIGenerationsResult,
      monthAIGenerationsResult,
    ] = await Promise.all([
      // Today's signups
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayISO),
      
      // This month's signups
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStartISO),
      
      // Total questions count
      supabase
        .from('questions')
        .select('id', { count: 'exact', head: true }),
      
      // Recent questions (last 10)
      supabase
        .from('questions')
        .select(`
          id,
          question_text,
          grade_level,
          difficulty,
          created_at,
          profiles:user_id (name, email)
        `)
        .order('created_at', { ascending: false })
        .limit(10),
      
      // Grade level statistics
      supabase
        .from('questions')
        .select('grade_level'),
      
      // Today's AI generations (from admin_logs if exists, otherwise estimate from questions)
      supabase
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayISO)
        .not('raw_ai_response', 'is', null),
      
      // This month's AI generations
      supabase
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStartISO)
        .not('raw_ai_response', 'is', null),
    ])

    // Process grade level statistics
    const gradeLevelCounts: Record<string, number> = {}
    if (gradeLevelStatsResult.data) {
      gradeLevelStatsResult.data.forEach((q) => {
        const level = q.grade_level || '미지정'
        gradeLevelCounts[level] = (gradeLevelCounts[level] || 0) + 1
      })
    }

    // Sort and get top 5 grade levels
    const topGradeLevels = Object.entries(gradeLevelCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([level, count]) => ({ grade_level: level, count }))

    // Try to get error logs count (if admin_logs table exists)
    let errorLogsCount = 0
    try {
      const { count } = await supabase
        .from('admin_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', todayISO)
      errorLogsCount = count || 0
    } catch {
      // Table might not exist yet
      errorLogsCount = 0
    }

    // Try to get download/purchase stats
    let downloadStats = { today: 0, month: 0 }
    try {
      const [todayDownloads, monthDownloads] = await Promise.all([
        supabase
          .from('admin_logs')
          .select('id', { count: 'exact', head: true })
          .in('type', ['question_download', 'question_purchase'])
          .gte('created_at', todayISO),
        supabase
          .from('admin_logs')
          .select('id', { count: 'exact', head: true })
          .in('type', ['question_download', 'question_purchase'])
          .gte('created_at', monthStartISO),
      ])
      downloadStats = {
        today: todayDownloads.count || 0,
        month: monthDownloads.count || 0,
      }
    } catch {
      // Table might not exist yet
    }

    const stats = {
      signups: {
        today: todaySignupsResult.count || 0,
        month: monthSignupsResult.count || 0,
      },
      questions: {
        total: totalQuestionsResult.count || 0,
      },
      aiGenerations: {
        today: todayAIGenerationsResult.count || 0,
        month: monthAIGenerationsResult.count || 0,
      },
      downloads: downloadStats,
      errorLogs: {
        today: errorLogsCount,
      },
      recentQuestions: recentQuestionsResult.data || [],
      topGradeLevels,
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}

