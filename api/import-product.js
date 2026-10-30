const { importItem } = require('../lib/meli');

module.exports = async (request, response) => {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método não permitido.' });
  try {
    const payload = request.body || {};
    return response.status(200).json(await importItem(payload.url || payload.itemId, payload.selectedItemId));
  } catch (error) {
    return response.status(422).json({ error: error.message });
  }
};
