const { config } = require('../lib/meli');

module.exports = (request, response) => {
  const values = config();
  response.status(200).json({
    ok: true,
    mercadoLivreCredentialsConfigured: Boolean(values.accessToken || (values.clientId && values.clientSecret && values.redirectUri)),
    mercadoLivreRefreshTokenConfigured: Boolean(values.refreshToken)
  });
};
