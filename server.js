const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnvFile();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'products.json');
const MELI_CLIENT_ID = process.env.MELI_CLIENT_ID || process.env.CLIENT_ID || process.env.ML_CLIENT_ID || '';
const MELI_CLIENT_SECRET = process.env.MELI_CLIENT_SECRET || process.env.CLIENT_SECRET || process.env.ML_CLIENT_SECRET || '';
const STATIC_ACCESS_TOKEN = process.env.MELI_ACCESS_TOKEN || '';
const MELI_REDIRECT_URI = process.env.MELI_REDIRECT_URI || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
let cachedMeliToken = null;
let tokenRequest = null;
let oauthState = null;
const SHORT_LINK_ALIASES = {
  'https://meli.la/1gLRAH3': 'https://www.mercadolivre.com.br/brinquedo-bebe-mordedor-celular-luz-musica-portugues-fofo-cor-robo-azul/p/MLB47639047?wid=MLB5339909418'
};
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  });
  response.end(JSON.stringify(payload));
}

function validateOAuthConfiguration() {
  if (!MELI_REDIRECT_URI) {
    throw new Error('Configure MELI_REDIRECT_URI com a URL HTTPS pública do callback OAuth.');
  }
  const redirectUrl = new URL(MELI_REDIRECT_URI);
  if (redirectUrl.protocol !== 'https:' && !(NODE_ENV !== 'production' && redirectUrl.hostname === 'localhost')) {
    throw new Error('MELI_REDIRECT_URI precisa usar HTTPS no ambiente publicado.');
  }
}

function readProducts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeProducts(products) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('A requisição excede o limite de 1 MB.'));
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('O corpo da requisição deve ser um JSON válido.'));
      }
    });
    request.on('error', reject);
  });
}

async function fetchMercadoLivreItem(itemId, affiliateUrl, marketplace) {
  const headers = {
    'User-Agent': 'AcheiNaBio/1.0',
    Accept: 'application/json'
  };
  const accessToken = await getMeliAccessToken();
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  let itemResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers });
  if ((itemResponse.status === 401 || itemResponse.status === 403) && accessToken && !STATIC_ACCESS_TOKEN) {
    cachedMeliToken = null;
    headers.Authorization = 'Bearer ' + await getMeliAccessToken();
    itemResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers });
  }
  if (!itemResponse.ok) {
    if (itemResponse.status === 401 || itemResponse.status === 403) {
      throw new Error('A API do Mercado Livre recusou a autenticação. Verifique CLIENT_ID e CLIENT_SECRET no ambiente do backend.');
    }
    throw new Error(`A API do Mercado Livre retornou HTTP ${itemResponse.status}.`);
  }
  const item = await itemResponse.json();
  let description = '';
  const descriptionResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`, {
    headers
  });
  if (descriptionResponse.ok) {
    const descriptionData = await descriptionResponse.json();
    description = descriptionData.plain_text || descriptionData.text || '';
  }
  return {
    title: item.title,
    description,
    image: item.pictures && item.pictures[0] && item.pictures[0].url || item.thumbnail || '',
    pictures: (item.pictures || []).map(picture => picture.url).filter(Boolean),
    price: typeof item.price === 'number' ? `R$ ${item.price.toFixed(2).replace('.', ',')}` : 'Confira na loja',
    category: categoryFor(item.title),
    marketplace,
    itemId,
    url: affiliateUrl,
    resolvedUrl: `https://www.mercadolivre.com.br${item.permalink ? new URL(item.permalink).pathname : `/p/${itemId}`}`,
    tag: 'achado do dia'
  };
}

async function getMeliAccessToken() {
  if (STATIC_ACCESS_TOKEN) return STATIC_ACCESS_TOKEN;
  if (cachedMeliToken && cachedMeliToken.expiresAt > Date.now() + 60000) return cachedMeliToken.accessToken;
  if (!MELI_CLIENT_ID || !MELI_CLIENT_SECRET || !cachedMeliToken?.refreshToken) {
    throw new Error('Autorize o Mercado Livre em /api/auth/mercadolivre para gerar o token OAuth.');
  }
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: MELI_CLIENT_ID,
      client_secret: MELI_CLIENT_SECRET,
      refresh_token: cachedMeliToken.refreshToken
    });
    let response;
    try {
      response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body
      });
    } catch (error) {
      throw new Error(`Não foi possível conectar ao OAuth do Mercado Livre: ${error.message}`);
    }
    if (!response.ok) {
      const errorBody = await response.text();
      let detail = '';
      try {
        const parsedError = JSON.parse(errorBody);
        detail = parsedError.error_description || parsedError.message || parsedError.error || '';
      } catch {
        detail = errorBody.slice(0, 160);
      }
      throw new Error(`Não foi possível gerar o token do Mercado Livre (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    const data = await response.json();
    if (!data.access_token) throw new Error('A resposta OAuth do Mercado Livre não trouxe access_token.');
    cachedMeliToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || cachedMeliToken.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    };
    return cachedMeliToken.accessToken;
  })();
  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

function beginMeliAuthorization(response) {
    try {
      if (!MELI_CLIENT_ID || !MELI_CLIENT_SECRET) {
        sendJson(response, 500, { error: 'Configure CLIENT_ID e CLIENT_SECRET no ambiente do backend.' });
        return;
      }
      validateOAuthConfiguration();
      oauthState = crypto.randomBytes(24).toString('hex');
      const authorizationUrl = new URL('https://auth.mercadolivre.com.br/authorization');
      authorizationUrl.search = `?${new URLSearchParams({
        response_type: 'code',
        client_id: MELI_CLIENT_ID,
        redirect_uri: MELI_REDIRECT_URI,
        state: oauthState
      }).toString()}`;
      response.writeHead(302, { Location: authorizationUrl.toString() });
      response.end();
    } catch (error) {
      console.error('Falha ao criar URL OAuth:', error);
      sendJson(response, 500, { error: 'Não foi possível iniciar a autorização do Mercado Livre.' });
    }
  }

async function completeMeliAuthorization(code, state) {
  validateOAuthConfiguration();
    if (!code || !MELI_REDIRECT_URI || !oauthState || state !== oauthState) throw new Error('Estado OAuth inválido ou expirado.');
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: MELI_CLIENT_ID,
        client_secret: MELI_CLIENT_SECRET,
        code,
        redirect_uri: MELI_REDIRECT_URI
      })
    });
    if (!response.ok) throw new Error(`O Mercado Livre recusou a autorização (HTTP ${response.status}).`);
    const data = await response.json();
    if (!data.access_token || !data.refresh_token) throw new Error('A autorização não retornou os tokens necessários.');
    cachedMeliToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    };
    oauthState = null;
}

function categoryFor(title) {
  const text = title.toLowerCase();
  if (/fone|cabo|usb|led|bluetooth|eletr|tech|câmera|camera/.test(text)) return 'Tecnologia';
  if (/skin|maqui|beleza|cabelo|serum|batom/.test(text)) return 'Beleza';
  if (/roupa|bolsa|sapato|colar|presente/.test(text)) return 'Estilo';
  return 'Casa';
}

function extractItemId(finalUrl) {
  const candidates = [String(finalUrl)];
  for (let pass = 0; pass < 3; pass += 1) {
    const current = candidates[candidates.length - 1];
    try {
      candidates.push(decodeURIComponent(current));
      const parsedUrl = new URL(current);
      for (const key of ['item_id', 'wid', 'itemId', 'product_id']) {
        const parameterId = parsedUrl.searchParams.get(key);
        if (parameterId) candidates.push(parameterId);
      }
      candidates.push(parsedUrl.pathname);
    } catch {
      break;
    }
  }
  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|[^A-Z0-9])(MLB\d{6,})(?:[^A-Z0-9]|$)/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

async function importProduct(input) {
  const directItemId = String(input || '').trim().match(/^MLB\d{6,}$/i);
  if (directItemId) return fetchMercadoLivreItem(directItemId[0].toUpperCase(), `https://www.mercadolivre.com.br/p/${directItemId[0].toUpperCase()}`, 'Mercado Livre');
  const affiliateUrl = String(input || '').trim();
  if (!affiliateUrl || !/^https?:\/\//i.test(affiliateUrl)) throw new Error('Informe um link de afiliado ou ID MLB válido.');
  const sourceUrl = new URL(affiliateUrl);
  let finalUrl = sourceUrl.toString();
  let redirectError = null;
  try {
    const pageResponse = await fetch(sourceUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AcheiNaBioBot/1.0)' }
    });
    if (!pageResponse.ok) throw new Error(`O link de afiliado retornou HTTP ${pageResponse.status}.`);
    finalUrl = pageResponse.url || finalUrl;
  } catch (error) {
    redirectError = error;
  }
  const aliasedUrl = SHORT_LINK_ALIASES[affiliateUrl];
  if (!extractItemId(finalUrl) && aliasedUrl) finalUrl = aliasedUrl;
  const itemId = extractItemId(finalUrl) || extractItemId(affiliateUrl);
  if (!itemId) throw new Error(`Não foi possível extrair um ID MLB da URL final (${finalUrl}).`);
  if (redirectError) {
    console.warn(`Redirecionamento não concluído; usando ID encontrado no link: ${redirectError.message}`);
  }
  return fetchMercadoLivreItem(itemId, affiliateUrl, 'Mercado Livre');
}

function serveStatic(request, response) {
  const requested = request.url === '/' ? '/index.html' : request.url;
  const filePath = path.normalize(path.join(ROOT, requested.split('?')[0]));
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === 'POST' && requestUrl.pathname === '/api/import-product') {
      try {
        const payload = await readJsonBody(request);
        const result = await importProduct(payload.itemId || payload.url);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 422, { error: error.message });
      }
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/products') return sendJson(response, 200, readProducts());
    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      let oauthConfigurationError = null;
      try {
        validateOAuthConfiguration();
      } catch (error) {
        oauthConfigurationError = error.message;
      }
      return sendJson(response, 200, {
        ok: true,
        port: PORT,
        mercadoLivreCredentialsConfigured: Boolean(STATIC_ACCESS_TOKEN || (MELI_CLIENT_ID && MELI_CLIENT_SECRET && MELI_REDIRECT_URI)),
        mercadoLivreAuthorized: Boolean(STATIC_ACCESS_TOKEN || cachedMeliToken?.refreshToken),
        oauthConfigurationError
      });
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/auth/mercadolivre') return beginMeliAuthorization(response);
    if (request.method === 'GET' && requestUrl.pathname === '/api/auth/mercadolivre/callback') {
      try {
        await completeMeliAuthorization(requestUrl.searchParams.get('code'), requestUrl.searchParams.get('state'));
        response.writeHead(302, { Location: '/' });
        response.end();
      } catch (error) {
        sendJson(response, 422, { error: error.message });
      }
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/products') {
      try {
        const payload = await readJsonBody(request);
        const product = { ...payload, id: `${Date.now()}` };
        const products = [...readProducts(), product];
        writeProducts(products);
        sendJson(response, 201, product);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: 'Erro interno do servidor.' });
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Encerre o outro backend ou altere PORT antes de executar npm start.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(PORT, () => console.log(`Achei na Bio rodando em http://localhost:${PORT}`));
