// Versão simplificada para debug - use temporariamente
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE = process.env.LEADS_TABLE || 'leads';
const TARGET_ORIGIN = 'https://annafrota.github.io';

let supabase;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
} catch (error) {
  console.error('Erro ao inicializar Supabase:', error);
}

function htmlResponse(success, message = '') {
  const status = success ? 'form_submitted' : 'form_error';
  const html = `
    <!doctype html>
    <html>
    <head><meta charset="utf-8"><title>${success ? 'Sucesso' : 'Erro'}</title></head>
    <body>
      <h1>${success ? 'Sucesso!' : 'Erro'}</h1>
      <p>${message}</p>
      <script>
        console.log('Enviando postMessage:', '${status}');
        try {
          window.top.postMessage('${status}', '${TARGET_ORIGIN}');
        } catch(e) {
          console.error('Erro no postMessage:', e);
        }
      </script>
    </body>
    </html>
  `;
  return html;
}

export async function handler(event, context) {
  console.log('=== INÍCIO DEBUG NETLIFY FUNCTION ===');
  console.log('HTTP Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body (raw):', event.body);
  console.log('Body type:', typeof event.body);
  console.log('Body length:', event.body ? event.body.length : 0);

  const corsHeaders = {
    'Access-Control-Allow-Origin': TARGET_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'text/html; charset=utf-8'
  };

  // Handle OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    console.log('Respondendo OPTIONS request');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Verificar variáveis de ambiente primeiro
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERRO: Variáveis de ambiente não configuradas');
    console.log('SUPABASE_URL exists:', !!SUPABASE_URL);
    console.log('SUPABASE_SERVICE_ROLE_KEY exists:', !!SUPABASE_SERVICE_ROLE_KEY);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: htmlResponse(false, 'Configuração do servidor incompleta')
    };
  }

  if (event.httpMethod !== 'POST') {
    console.log('Método não permitido:', event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: htmlResponse(false, 'Método não permitido')
    };
  }

  // Parse simples dos dados - aceitar qualquer formato
  let data = {};
  try {
    if (event.body) {
      // Tentar parse como URLSearchParams primeiro
      const params = new URLSearchParams(event.body);
      for (const [key, value] of params.entries()) {
        data[key] = value;
        console.log(`Campo parseado: ${key} = "${value}"`);
      }
    }
  } catch (parseError) {
    console.error('Erro no parse:', parseError);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlResponse(false, 'Erro no parse dos dados')
    };
  }

  console.log('Dados finais parseados:', JSON.stringify(data, null, 2));

  // Validação mínima - só verificar se tem dados
  if (Object.keys(data).length === 0) {
    console.log('Nenhum dado recebido');
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlResponse(false, 'Nenhum dado recebido')
    };
  }

  // Honeypot check
  if (data.company && data.company.trim() !== '') {
    console.log('Honeypot detectado, retornando sucesso falso');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: htmlResponse(true, 'Processado (honeypot)')
    };
  }

  // Extrair campos principais
  const name = (data.name || '').trim();
  const email = (data.email || '').trim();
  const phone = (data.phone || '').trim();
  const quantity = (data.quantity || '').trim();
  const contrib = (data.contrib || '').trim();
  const type = (data.type || '').trim();
  const consent = data.consent;

  console.log('Campos extraídos:');
  console.log('- name:', name);
  console.log('- email:', email);
  console.log('- phone:', phone);
  console.log('- quantity:', quantity);
  console.log('- contrib:', contrib);
  console.log('- type:', type);
  console.log('- consent:', consent);

  // Validação básica
  if (!name) {
    console.log('Nome não fornecido');
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlResponse(false, 'Nome é obrigatório')
    };
  }

  if (!email) {
    console.log('Email não fornecido');
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlResponse(false, 'Email é obrigatório')
    };
  }

  // Validação de email básica
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log('Email inválido:', email);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlResponse(false, 'Email inválido')
    };
  }

  // Verificar consentimento
  const consentOk = ['on', 'true', '1', 'yes'].includes((consent || '').toLowerCase());
  if (!consentOk) {
    console.log('Consentimento não fornecido ou inválido:', consent);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlResponse(false, 'É necessário aceitar a Política de Privacidade')
    };
  }

  // Tentar salvar no Supabase
  try {
    console.log('Tentando salvar no Supabase...');
    
    const payload = {
      created_at: new Date().toISOString(),
      name: name,
      email: email,
      phone: phone || null,
      quantity: quantity || null,
      contribution: contrib || null,
      form_type: type || 'unknown',
      consent: true,
      user_agent: event.headers['user-agent'] || '',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '',
      raw_data: JSON.stringify(data)
    };

    console.log('Payload para Supabase:', JSON.stringify(payload, null, 2));

    const { data: result, error } = await supabase.from(TABLE).insert(payload);
    
    if (error) {
      console.error('Erro do Supabase:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: htmlResponse(false, `Erro no banco de dados: ${error.message}`)
      };
    }

    console.log('Dados salvos com sucesso:', result);
    console.log('=== FIM DEBUG - SUCESSO ===');
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: htmlResponse(true, 'Dados salvos com sucesso')
    };

  } catch (error) {
    console.error('Erro inesperado:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: htmlResponse(false, `Erro inesperado: ${error.message}`)
    };
  }
}
