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
  return [
    '<!doctype html><meta charset="utf-8">',
    '<p>OK</p>',
    '<script>',
    `  (function(){ try { window.top.postMessage('form_submitted', '${TARGET_ORIGIN}'); } catch(e) {} })();`,
    '</script>'
  ].join('');
}

function htmlError(msg = 'Erro') {
  const safe = String(msg).replace(/[<>&"'`]/g, s => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
  }[s]));
  return [
    '<!doctype html><meta charset="utf-8">',
    `<p>${safe}</p>`,
    '<script>',
    `  (function(){ try { window.top.postMessage('form_error', '${TARGET_ORIGIN}'); } catch(e) {} })();`,
    '</script>'
  ].join('');
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
    return { statusCode: 405, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('Método não permitido') };
  }

  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('Content-Type inválido') };
  }

  const data = parseForm(event.body || '');

  // Honeypot
  if (data.company && data.company.trim() !== '') {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlOk() };
  }

  // Campos aceitando variantes (download vs compra)
  const name = (data.name || data['d-name'] || '').trim();
  const email = (data.email || data['d-email'] || '').trim();

  // Validação
  if (!name || !email) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('Nome e e-mail são obrigatórios.') };
  }
  if (!isValidEmail(email)) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('E-mail inválido.') };
  }

  // Consentimento: aceita qualquer checkbox marcado
  const consent = data['consent'] || data['terms-compra'] || data['terms-download'] || '';
  const consentOk = ['on', 'true', '1', 'yes'].includes(consent.toLowerCase());
  if (!consentOk) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('É necessário aceitar a Política de Privacidade.') };
  }

  // Campos adicionais
  const phone = (data.phone || '').trim();
  const quantity = (data.quantity || '').trim();
  const contrib = (data['d-contrib'] || '').trim();
  const formType = (data.type || '').trim(); // "purchase" ou "download"

  try {
    const payload = {
      created_at: new Date().toISOString(),
      type: formType,
      name,
      email,
      phone,
      quantity,
      contrib,
      consent: true,
      user_agent: event.headers['user-agent'] || '',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '',
      raw: data
    };

    const { error } = await supabase.from(TABLE).insert(payload);
    if (error) {
      console.error('Supabase insert error:', error);
      return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('Falha ao salvar. Tente novamente.') };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlOk() };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: htmlError('Erro inesperado. Tente novamente.') };
  }
}
