const crypto = require('crypto');

let tokenCache = null;
let tokenRequest = null;

function config() {
  const configuredRefreshToken = process.env.MELI_REFRESH_TOKEN || '';
  const configuredAccessToken = process.env.MELI_LIVE_ACCESS_TOKEN || process.env.MELI_ACCESS_TOKEN || (
    configuredRefreshToken.startsWith('APP_USR-') ? configuredRefreshToken : ''
  );
  return {
    clientId: process.env.MELI_CLIENT_ID || process.env.CLIENT_ID || '',
    clientSecret: process.env.MELI_CLIENT_SECRET || process.env.CLIENT_SECRET || '',
    accessToken: configuredAccessToken,
    refreshToken: configuredAccessToken ? '' : configuredRefreshToken,
    redirectUri: process.env.MELI_REDIRECT_URI || ''
  };
}

function getOAuthConfig() {
  const values = config();
  if (!values.clientId || !values.clientSecret || !values.redirectUri) {
    throw new Error('Configure MELI_CLIENT_ID, MELI_CLIENT_SECRET e MELI_REDIRECT_URI.');
  }
  const redirect = new URL(values.redirectUri);
  if (redirect.protocol !== 'https:' && !(redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1')) {
    throw new Error('MELI_REDIRECT_URI precisa usar HTTPS.');
  }
  return values;
}

function signedState(secret) {
  const nonce = crypto.randomBytes(18).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  return `${nonce}.${signature}`;
}

function validState(state, secret) {
  if (!state || !secret) return false;
  const [nonce, signature] = state.split('.');
  if (!nonce || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function authorizationUrl() {
  const values = getOAuthConfig();
  const stateSecret = process.env.OAUTH_STATE_SECRET || values.clientSecret;
  const url = new URL('https://auth.mercadolivre.com.br/authorization');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: values.clientId,
    redirect_uri: values.redirectUri,
    state: signedState(stateSecret)
  }).toString();
  return url.toString();
}

async function exchangeCode(code, state) {
  const values = getOAuthConfig();
  const stateSecret = process.env.OAUTH_STATE_SECRET || values.clientSecret;
  if (!code || !validState(state, stateSecret)) throw new Error('Estado OAuth inválido.');
  const response = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: values.clientId,
      client_secret: values.clientSecret,
      code,
      redirect_uri: values.redirectUri
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || `OAuth recusado (HTTP ${response.status}).`);
  tokenCache = { accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache;
}

async function accessToken() {
  const values = config();
  if (values.accessToken) return values.accessToken;
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.accessToken;
  const refreshToken = tokenCache?.refreshToken || values.refreshToken;
  if (!values.clientId || !values.clientSecret || !refreshToken) throw new Error('Configure MELI_ACCESS_TOKEN ou autorize o Mercado Livre e defina MELI_REFRESH_TOKEN.');
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: values.clientId, client_secret: values.clientSecret, refresh_token: refreshToken })
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(data.error_description || `Não foi possível renovar o token (HTTP ${response.status}).`);
    tokenCache = { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return tokenCache.accessToken;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

function categoryFor(title) {
  const text = String(title || '').toLowerCase();
  if (/fone|cabo|usb|led|bluetooth|eletr|tech|câmera|camera/.test(text)) return 'Tecnologia';
  if (/skin|maqui|beleza|cabelo|serum|batom/.test(text)) return 'Beleza';
  if (/roupa|bolsa|sapato|colar|presente/.test(text)) return 'Estilo';
  return 'Casa';
}

function extractItemId(value) {
  const text = decodeURIComponent(String(value || ''));
  const match = text.match(/(?:^|[^A-Z0-9])(MLB\d{6,})(?:[^A-Z0-9]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function extractItemIds(value) {
  const text = decodeURIComponent(String(value || ''));
  const ids = text.match(/(?:^|[^A-Z0-9])(MLB\d{6,})(?:[^A-Z0-9]|$)/gi) || [];
  return [...new Set(ids.map(id => id.toUpperCase()))];
}

function extractListingIds(value) {
  const text = decodeURIComponent(String(value || ''));
  const explicit = [...text.matchAll(/(?:wid|item_id|itemId|product_id)[=:](MLB\d{6,})/gi)]
    .map(match => match[1].toUpperCase());
  return [...new Set(explicit.length ? explicit : extractItemIds(text))];
}

function trackingUrl(permalink, sourceUrl) {
  const result = new URL(permalink);
  const source = new URL(sourceUrl);
  ['ref', 'matt_word', 'matt_tool', 'matt_campaign', 'matt_content'].forEach(key => {
    const value = source.searchParams.get(key);
    if (value) result.searchParams.set(key, value);
  });
  return result.toString();
}

async function fetchItem(itemId, affiliateUrl) {
  const token = await accessToken();
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
  const itemResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers });
  const item = await itemResponse.json();
  if (!itemResponse.ok) throw new Error(item.message || `API de itens recusou a consulta (HTTP ${itemResponse.status}).`);
  let description = '';
  const descriptionResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`, { headers });
  if (descriptionResponse.ok) {
    const data = await descriptionResponse.json();
    description = data.plain_text || data.text || '';
  }
  const permalink = item.permalink || `https://www.mercadolivre.com.br/p/${itemId}`;
  return {
    title: item.title,
    description,
    image: item.pictures?.[0]?.url || item.thumbnail || '',
    pictures: (item.pictures || []).map(picture => picture.url).filter(Boolean),
    price: typeof item.price === 'number' ? `R$ ${item.price.toFixed(2).replace('.', ',')}` : 'Confira na loja',
    category: categoryFor(item.title),
    marketplace: 'Mercado Livre',
    itemId,
    url: affiliateUrl,
    resolvedUrl: permalink,
    affiliateUrl: trackingUrl(permalink, affiliateUrl),
    tag: 'achado do dia'
  };
}

async function resolveAffiliateUrl(input) {
  const originalUrl = String(input || '').trim();
  const response = await fetch(originalUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AcheiNaBioBot/1.0)' }
  });
  const resolvedUrl = response.url || originalUrl;
  const body = await response.text();
  const links = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => ({
      url: decodeURIComponent(match[1].replace(/&amp;/g, '&')),
      label: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      index: match.index
    }))
    .filter(link => /\/p\/MLB|item_id|wid=MLB/i.test(link.url));
  const productLinks = links.map(link => {
    const context = body.slice(Math.max(0, link.index - 20000), link.index + 1000);
    const image = context.match(/<img[^>]+class=["'][^"']*poly-component__picture[^"']*["'][^>]+src=["']([^"']+)/i);
    const imageAlt = context.match(/<img[^>]+class=["'][^"']*poly-component__picture[^"']*["'][^>]+alt=["']([^"']*)/i);
    const prices = context.match(/R(?:\$|&#36;)\s*[\d.]+,\d{2}/gi) || [];
    return {
      ...link,
      image: image ? image[1] : '',
      title: imageAlt ? imageAlt[1].trim() : '',
      price: prices.length ? prices[prices.length - 1].replace('&#36;', '$') : 'Confira na loja'
    };
  });
  const ids = [...new Set([
    ...extractItemIds(resolvedUrl),
    ...(productLinks.length ? productLinks.flatMap(link => extractListingIds(link.url)) : extractItemIds(body))
  ])].slice(0, 30);
  return { originalUrl, resolvedUrl, directId: extractItemId(resolvedUrl), ids, links: productLinks };
}

async function searchItems(query) {
  const term = String(query || '').trim();
  if (term.length < 2) throw new Error('Digite pelo menos 2 caracteres para buscar.');
  const token = await accessToken();
  const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(term)}&limit=12`, {
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `A busca do Mercado Livre falhou (HTTP ${response.status}).`);
  return (data.results || []).map(item => ({
    itemId: item.id,
    title: item.title,
    image: item.thumbnail || item.pictures?.[0]?.url || '',
    price: typeof item.price === 'number' ? `R$ ${item.price.toFixed(2).replace('.', ',')}` : 'Confira na loja',
    permalink: item.permalink || `https://www.mercadolivre.com.br/p/${item.id}`,
    category: categoryFor(item.title)
  }));
}

async function importItem(input, selectedItemId) {
  const originalInput = typeof input === 'string' ? input.trim() : '';
  let affiliateUrl = originalInput;
  let itemId = selectedItemId || extractItemId(affiliateUrl);
  if (!itemId && /^https?:\/\//i.test(affiliateUrl)) {
    const resolved = await resolveAffiliateUrl(affiliateUrl);
    if (!resolved.directId && resolved.ids.length > 1 && !selectedItemId) {
      const candidates = await Promise.all(resolved.ids.map(id => fetchItem(id, resolved.resolvedUrl).catch(() => {
        const source = resolved.links.find(link => extractListingIds(link.url).includes(id));
        return {
        itemId: id,
        title: source?.title || `Produto Mercado Livre ${id}`,
        image: source?.image || '',
        price: source?.price || 'Confira na loja',
        category: categoryFor(source?.title || ''),
        affiliateUrl: source?.url || originalInput
        };
      })));
      return {
        type: 'selection',
        sourceUrl: originalInput,
        resolvedUrl: resolved.resolvedUrl,
        candidates: candidates.filter(Boolean).map(product => ({
          itemId: product.itemId,
          title: product.title,
          image: product.image,
          price: product.price,
          category: product.category,
          affiliateUrl: product.affiliateUrl
        }))
      };
    }
    affiliateUrl = resolved.resolvedUrl;
    itemId = selectedItemId || resolved.directId || resolved.ids[0];
  }
  if (!itemId) throw new Error('Não foi possível encontrar um ID MLB no link.');
  try {
    return await fetchItem(itemId, affiliateUrl);
  } catch (error) {
    if (!/^https?:\/\//i.test(originalInput)) throw error;
    const resolved = await resolveAffiliateUrl(originalInput);
    const source = resolved.links.find(link => extractListingIds(link.url).includes(itemId));
    if (!source) throw error;
    return {
      title: source.title || `Produto Mercado Livre ${itemId}`,
      description: 'Dados importados do link de afiliado. Revise a descrição antes de publicar.',
      image: source.image || '',
      pictures: source.image ? [source.image] : [],
      price: source.price || 'Confira na loja',
      category: categoryFor(source.title || ''),
      marketplace: 'Mercado Livre',
      itemId,
      url: source.url,
      resolvedUrl: source.url,
      affiliateUrl: source.url,
      tag: 'achado do dia',
      importWarning: `A API do Mercado Livre não liberou os detalhes (${error.message}). Os dados visíveis do anúncio foram importados do link afiliado.`
    };
  }
}

module.exports = { accessToken, authorizationUrl, exchangeCode, importItem, searchItems, config };
