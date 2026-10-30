const { exchangeCode } = require('../../../lib/meli');

module.exports = async (request, response) => {
  try {
    const token = await exchangeCode(request.query.code, request.query.state);
    response.status(200).send(`Autorização concluída. Configure MELI_REFRESH_TOKEN=${token.refreshToken} na Vercel e faça novo deploy.`);
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
};
