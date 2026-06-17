import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  // Verifikasi caller adalah admin
  const { data: isAdmin } = await supabaseUser.rpc('has_role', { p_role: 'admin' })
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const { athlete_id } = await req.json()
  if (!athlete_id) {
    return new Response(JSON.stringify({ error: 'athlete_id required' }), { status: 400 })
  }

  // Ambil auth_id dari athletes
  const { data: athlete } = await supabaseUser
    .from('athletes')
    .select('auth_id')
    .eq('id', athlete_id)
    .single()

  if (!athlete?.auth_id) {
    return new Response(JSON.stringify({ error: 'Athlete not found' }), { status: 404 })
  }

  // Hapus dari athletes (cascade ke semua tabel terkait)
  await supabaseUser.from('athletes').delete().eq('id', athlete_id)

  // Hapus dari auth.users via service role
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(athlete.auth_id)
  if (authError) {
    return new Response(JSON.stringify({ error: authError.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 })
})
