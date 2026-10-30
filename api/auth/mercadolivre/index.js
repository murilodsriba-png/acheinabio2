const { authorizationUrl } = require('../../../lib/meli');

module.exports = (request, response) => {
  try {
    response.redirect(302, authorizationUrl());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
};
