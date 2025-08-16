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
    `  (function(){ try { window.top.postMessage('form_submitted', '${TARGET_ORIGIN}'); } catch(e) {} })();`,
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
    `  (function(){ try { window.top.postMessage('form_error', '${TARGET_ORIGIN}'); } catch(e) {} })();`,
    '</script>'
  ].join('');
  return html;
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('Método não permitido')
    };
  }

  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('Content-Type inválido')
    };
  }

  const data = parseForm(event.body || '');

  // Honeypot
  if (data.company && data.company.trim() !== '') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlOk()
    };
  }

  // Validação
  const name = (data.name || '').trim();
  const email = (data.email || '').trim();

  if (!name || !email) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('Nome e e-mail são obrigatórios.')
    };
  }
  if (!isValidEmail(email)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('E-mail inválido.')
    };
  }

  // Consentimento
  const consent = (data.consent || '').toLowerCase();
  const consentOk = ['on', 'true', '1', 'yes'].includes(consent);
  if (!consentOk) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('É necessário aceitar a Política de Privacidade.')
    };
  }

  // Campos adicionais
  const phone = (data.phone || '').trim();
  const quantity = (data.quantity || '').trim();
  const formType = (data.formType || '').trim() || inferFormType(data);

  try {
    const payload = {
      created_at: new Date().toISOString(),
      name,
      email,
      phone,
      quantity,
      form_type: formType,
      consent: true,
      user_agent: event.headers['user-agent'] || '',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '',
      raw: data
    };

    const { error } = await supabase.from(TABLE).insert(payload);
    if (error) {
      console.error('Supabase insert error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlError('Falha ao salvar. Tente novamente.')
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlOk()
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('Erro inesperado. Tente novamente.')
    };
  }
}

function inferFormType(obj) {
  if (obj.quantity && String(obj.quantity).trim() !== '') return 'buy';
  return 'download';
}
