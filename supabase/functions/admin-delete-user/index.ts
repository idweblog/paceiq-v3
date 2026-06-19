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

  const { data: isAdmin, error: roleError } = await supabaseUser.rpc('has_role', { role_name: 'admin' })
  console.log('isAdmin:', isAdmin, 'roleError:', JSON.stringify(roleError))
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: corsHeaders
    })
  }

  let body: { athlete_id?: string }
  try {
    body = await req.json()
  } catch (e) {
    console.log('json parse error:', e)
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders
    })
  }

  const { athlete_id } = body
  if (!athlete_id) {
    return new Response(JSON.stringify({ error: 'athlete_id required' }), {
      status: 400, headers: corsHeaders
    })
  }

  const { data: athlete, error: fetchError } = await supabaseAdmin
    .from('athletes')
    .select('auth_id')
    .eq('id', athlete_id)
    .single()

  console.log('athlete:', JSON.stringify(athlete), 'fetchError:', JSON.stringify(fetchError))

  if (fetchError || !athlete?.auth_id) {
    return new Response(JSON.stringify({ error: 'Athlete not found', detail: fetchError?.message }), {
      status: 404, headers: corsHeaders
    })
  }

  const { error: deleteError } = await supabaseAdmin.rpc('delete_auth_user', {
    p_auth_id: athlete.auth_id
  })
  console.log('deleteError:', JSON.stringify(deleteError))

  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500, headers: corsHeaders
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: corsHeaders
  })
})
