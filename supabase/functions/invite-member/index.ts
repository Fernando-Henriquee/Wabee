// Convite de pessoas para uma empresa (Edge Function do Supabase, Deno).
//
// O que faz, nesta ordem:
//   1. Confere o login de quem chama (verify_jwt) e usa o JWT dela para chamar a RPC
//      invite_member: o banco confirma que a pessoa é DONA da empresa e registra o convite.
//   2. Só então usa a chave administrativa (service_role, que existe apenas aqui, no ambiente da
//      função, nunca no navegador) para mandar o e-mail de cadastro do Supabase. Se o e-mail já
//      tem conta, o convite aparece para a pessoa quando ela entrar no app.
//
// Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já vêm do Supabase.
// Defina SITE_URL (endereço do app, ex.: https://wabee.vercel.app) com `supabase secrets set`.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': siteUrl || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return reply(401, { error: 'Entre novamente para convidar.' });

  let payload: { email?: unknown; company_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return reply(400, { error: 'Pedido inválido.' });
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const companyId = typeof payload.company_id === 'string' ? payload.company_id : '';
  if (!email || !UUID.test(companyId)) return reply(400, { error: 'Informe o e-mail da pessoa.' });

  const url = Deno.env.get('SUPABASE_URL')!;

  // 1) Como a própria pessoa: a RPC confere dono e empresa ativa.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization, 'x-company-id': companyId } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: inviteError } = await asUser.rpc('invite_member', { p_email: email });
  if (inviteError) return reply(400, { error: inviteError.message });

  // 2) E-mail de cadastro para quem ainda não tem conta.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl ? `${siteUrl}/redefinir-senha` : undefined,
  });
  const alreadyRegistered = mailError && /already|registered|exists/i.test(mailError.message);
  if (mailError && !alreadyRegistered) {
    // O convite ficou registrado: a pessoa pode criar a conta pela tela de entrada e aceitar depois.
    return reply(502, { error: 'Convite registrado, mas o e-mail não pôde ser enviado agora. Tente de novo em alguns minutos.' });
  }
  return reply(200, { invited: true });
});
