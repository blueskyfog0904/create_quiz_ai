'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  console.log('--------------------------------------------------')
  console.log('[Login Action] Started')
  
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  console.log(`[Login Action] Attempting login for: ${email}`)

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error('[Login Action] Supabase Error:', error.message)
    
    // Check if the error is due to unconfirmed email
    if (error.message === 'Email not confirmed') {
      return { 
        success: false, 
        error: '이메일 인증이 완료되지 않았습니다. 이메일을 확인하여 인증 링크를 클릭해주세요.',
        needConfirmation: true 
      }
    }
    
    return { success: false, error: error.message }
  }

  if (data.session) {
    console.log('[Login Action] Success - Session created, User ID:', data.user?.id)
    revalidatePath('/', 'layout')
    return { success: true }
  } else {
    console.warn('[Login Action] No session returned')
    return { success: false, error: '세션을 생성할 수 없습니다.' }
  }
}

export async function signup(formData: FormData) {
  console.log('--------------------------------------------------')
  console.log('[Signup Action] Started')
  
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  
  // Extract profile fields
  const name = formData.get('name') as string
  const phone = formData.get('phone') as string
  const birthdate = formData.get('birthdate') as string
  const organization = formData.get('organization') as string
  const gender = formData.get('gender') as string
  const address = formData.get('address') as string

  console.log(`[Signup Action] Data received - Email: ${email}, Name: ${name}, Phone: ${phone}, Birthdate: ${birthdate || 'empty'}`)

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
        data: {
            full_name: name,
            phone: phone || null,
            birthdate: birthdate || null, // Handle empty string as null
            organization: organization || null,
            gender: gender || null,
            address: address || null,
            provider: 'email'
        }
    }
  })

  if (error) {
    console.error('[Signup Action] Supabase Error:', error.message)
    return { success: false, error: error.message }
  }

  if (data.user) {
    console.log('[Signup Action] Success - User ID:', data.user.id)
    // Return success data instead of redirecting immediately, so UI can show confirmation
    return { 
      success: true, 
      data: {
        email: data.user.email,
        name: name,
        phone: phone
      }
    }
  } else {
    console.warn('[Signup Action] No user returned (Check email confirmation settings)')
    // Even if session is null (email confirmation required), user is created.
    return { 
        success: true, 
        data: {
          email: email,
          name: name,
          phone: phone
        }
      }
  }
}
