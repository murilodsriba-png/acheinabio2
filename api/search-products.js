const { searchItems } = require('../lib/meli');

module.exports = async (request, response) => {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Método não permitido.' });
  try {
    const query = new URL(request.url, 'https://acheinabio.local').searchParams.get('q');
    return response.status(200).json({ products: await searchItems(query) });
  } catch (error) {
    return response.status(422).json({ error: error.message });
  }
};
