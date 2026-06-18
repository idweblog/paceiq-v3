import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabaseAdmin = createClient(url, key)
    const body = await req.json()

    if (body.auth_id) {
      const { error } = await supabaseAdmin.auth.admin.updateUser(body.auth_id, { email_confirm: true })
      if (error) return new Response(JSON.stringify({ ok: false, error: error.message, status: error.status, name: error.name }), { status: 200, headers: corsHeaders })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders })
    }

    if (body.email && body.password) {
      const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'apikey': key,
        },
        body: JSON.stringify({
          email: body.email,
          password: body.password,
          email_confirm: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) return new Response(JSON.stringify({ ok: false, error: JSON.stringify(data) }), { status: 200, headers: corsHeaders })
      return new Response(JSON.stringify({ ok: true, auth_id: data.id }), { status: 200, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: false, error: 'email and password required' }), { status: 200, headers: corsHeaders })

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200, headers: corsHeaders })
  }
})
