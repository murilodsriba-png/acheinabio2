const { exchangeCode } = require('../../../lib/meli');

module.exports = async (request, response) => {
  try {
    const token = await exchangeCode(request.query.code, request.query.state);
    response.status(200).send([
      '<!doctype html><meta charset="utf-8"><title>Autorização concluída</title>',
      '<h1>Autorização concluída</h1>',
      '<p>Configure estes valores como variáveis secretas na Vercel e faça um novo deploy:</p>',
      `<p><strong>MELI_ACCESS_TOKEN</strong>=${token.accessToken}</p>`,
      `<p><strong>MELI_REFRESH_TOKEN</strong>=${token.refreshToken}</p>`,
      '<p>Não compartilhe esses valores nem os publique no GitHub.</p>'
    ].join(''));
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
};
