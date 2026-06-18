import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders
    })
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

  const { data: isAdmin } = await supabaseUser.rpc('has_role', { role_name: 'admin' })
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: corsHeaders
    })
  }

  const { athlete_id } = await req.json()
  if (!athlete_id) {
    return new Response(JSON.stringify({ error: 'athlete_id required' }), {
      status: 400, headers: corsHeaders
    })
  }

  const { data: athlete } = await supabaseUser
    .from('athletes')
    .select('auth_id')
    .eq('id', athlete_id)
    .single()

  if (!athlete?.auth_id) {
    return new Response(JSON.stringify({ error: 'Athlete not found' }), {
      status: 404, headers: corsHeaders
    })
  }

  await supabaseUser.from('athletes').delete().eq('id', athlete_id)

  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(athlete.auth_id)
  if (authError) {
    return new Response(JSON.stringify({ error: authError.message }), {
      status: 500, headers: corsHeaders
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: corsHeaders
  })
})
