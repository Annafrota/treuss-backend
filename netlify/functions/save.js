// Netlify Functions (Node 18+)
// Recebe POST dos <form>, valida honeypot/consentimento, grava no Supabase
// e responde com HTML que faz postMessage('form_submitted'|'form_error') ao parent.
// Compatível com <iframe name="gsheet_iframe"> da landing em https://annafrota.github.io/Treuss-energia/

import { createClient } from '@supabase/supabase-js';

// ⚠️ Variáveis definidas no painel da Netlify (Site settings → Environment variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE = process.env.LEADS_TABLE || 'leads';

// Domínio final permitido para postMessage
const TARGET_ORIGIN = 'https://annafrota.github.io';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

function htmlOk() {
  const html = [
    '<!doctype html><meta charset="utf-8">',
    '<p>OK</p>',
    '<script>',
    `  (function(){ try { window.top.postMessage('form_submitted', '${TARGET_ORIGIN}'); } catch(e) { console.error('PostMessage error:', e); } })();`,
    '</script>'
  ].join('');
  return html;
}

function htmlError(msg = 'Erro') {
  const safe = String(msg).replace(/[<>&"'`]/g, s => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
  }[s]));
  const html = [
    '<!doctype html><meta charset="utf-8">',
    `<p>${safe}</p>`,
    '<script>',
    `  (function(){ try { window.top.postMessage('form_error', '${TARGET_ORIGIN}'); } catch(e) { console.error('PostMessage error:', e); } })();`,
    '</script>'
  ].join('');
  return html;
}

function parseForm(body, contentType) {
  try {
    if (!body) {
      console.log('Body vazio recebido');
      return {};
    }
    
    console.log('Body raw:', body);
    console.log('Content-Type:', contentType);
    
    // Se for multipart, precisamos de um parser diferente
    if (contentType.includes('multipart/form-data')) {
      // Para multipart, vamos usar uma abordagem simples
      const obj = {};
      // Este é um parser básico - em produção, use uma biblioteca apropriada
      return obj;
    }
    
    // Parse URL-encoded
    const params = new URLSearchParams(body);
    const obj = {};
    for (const [k, v] of params.entries()) {
      obj[k] = v;
      console.log(`Parsed field: ${k} = ${v}`);
    }
    
    console.log('Dados parseados final:', obj);
    return obj;
    
  } catch (error) {
    console.error('Erro no parse do formulário:', error);
    return {};
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

export async function handler(event, context) {
  console.log('Function called:', event.httpMethod, event.path);
  
  // Headers CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': TARGET_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'text/html; charset=utf-8'
  };

  // Handle OPTIONS (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: htmlError('Método não permitido')
    };
  }

  // Log para debug
  console.log('Headers recebidos:', JSON.stringify(event.headers, null, 2));
  console.log('Body recebido:', event.body);

  const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  console.log('Content-Type recebido:', contentType);
  
  // Aceitar tanto form-urlencoded quanto multipart (caso o browser envie)
  if (!contentType.includes('application/x-www-form-urlencoded') && 
      !contentType.includes('multipart/form-data')) {
    console.error('Content-Type inválido:', contentType);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlError(`Content-Type inválido: ${contentType}`)
    };
  }

  const data = parseForm(event.body || '', contentType);
  console.log('Dados parseados:', data);

  // Honeypot
  if (data.company && data.company.trim() !== '') {
    console.log('Honeypot detectado, ignorando requisição');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: htmlOk()
    };
  }

  // Validação
  const name = (data.name || '').trim();
  const email = (data.email || '').trim();

  if (!name || !email) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlError('Nome e e-mail são obrigatórios.')
    };
  }
  if (!isValidEmail(email)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlError('E-mail inválido.')
    };
  }

  // Consentimento
  const consent = (data.consent || '').toLowerCase();
  const consentOk = ['on', 'true', '1', 'yes'].includes(consent);
  if (!consentOk) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: htmlError('É necessário aceitar a Política de Privacidade.')
    };
  }

  // Campos adicionais
  const phone = (data.phone || '').trim();
  const quantity = (data.quantity || '').trim();
  const contribution = (data.contrib || '').trim();
  const formType = (data.type || '').trim() || inferFormType(data);

  try {
    // Verificar se as variáveis de ambiente estão configuradas
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Variáveis de ambiente do Supabase não configuradas');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: htmlError('Configuração do servidor incompleta.')
      };
    }

    const payload = {
      created_at: new Date().toISOString(),
      name,
      email,
      phone: phone || null,
      quantity: quantity || null,
      contribution: contribution || null,
      form_type: formType,
      consent: true,
      user_agent: event.headers['user-agent'] || '',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '',
      raw_data: JSON.stringify(data)
    };

    console.log('Tentando inserir no Supabase:', payload);

    const { error } = await supabase.from(TABLE).insert(payload);
    if (error) {
      console.error('Supabase insert error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: htmlError('Falha ao salvar. Tente novamente.')
      };
    }

    console.log('Dados inseridos com sucesso');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: htmlOk()
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: htmlError('Erro inesperado. Tente novamente.')
    };
  }
}

function inferFormType(obj) {
  if (obj.type === 'purchase' || (obj.quantity && String(obj.quantity).trim() !== '')) return 'purchase';
  if (obj.type === 'download') return 'download';
  return 'unknown';
}
