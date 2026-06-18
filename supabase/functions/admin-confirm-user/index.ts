import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const body = await req.json()

  // Mode 1: confirm existing user (dipanggil saat admin approve)
  if (body.auth_id) {
    const { error } = await supabaseAdmin.auth.admin.updateUser(body.auth_id, {
      email_confirm: true
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders })
  }

  // Mode 2: create user dengan auto-confirm (untuk open_admin_approval)
  if (body.email && body.password) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    return new Response(JSON.stringify({ auth_id: data.user.id }), { status: 200, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: corsHeaders })
})
