const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'products.json');
function readProducts() {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

module.exports = (request, response) => {
  if (request.method === 'GET') return response.status(200).json(readProducts());
  if (request.method === 'POST') return response.status(201).json({ ...request.body, id: `${Date.now()}` });
  return response.status(405).json({ error: 'Método não permitido.' });
};
