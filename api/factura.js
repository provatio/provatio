// ═══════════════════════════════════════════════════════════════════════════
// PROVATIO — Lectura de facturas con IA
// Función serverless para Vercel.
//
// INSTALACIÓN (una sola vez):
//   1. En el repo provatio/provatio, creá la carpeta  api/
//   2. Subí este archivo como  api/factura.js  (renombrar: api-factura.js → factura.js)
//   3. En Vercel → Settings → Environment Variables, agregá:
//        ANTHROPIC_API_KEY = (tu key de https://console.anthropic.com)
//   4. Redeploy. Listo: el botón "📷 Foto/PDF" de Provatio queda operativo.
//
// La key vive SOLO en el servidor de Vercel. Nunca llega al navegador.
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel' });
  }

  try {
    const { mediaType, data, categorias, ingredientes } = req.body || {};
    if (!data) return res.status(400).json({ error: 'Falta el archivo' });

    const esPdf = (mediaType || '').includes('pdf');

    // Bloque de contenido según tipo de archivo
    const bloqueArchivo = esPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data } };

    const prompt = `Sos un asistente de carga de facturas para un sistema de costos gastronómicos argentino.
Leé esta factura/remito de proveedor y extraé los datos en JSON.

Respondé ÚNICAMENTE con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional:
{
  "proveedor": "nombre del proveedor o comercio",
  "numero": "número de factura o comprobante si figura, sino \"\"",
  "fecha": "YYYY-MM-DD",
  "items": [
    {
      "descripcion": "nombre del producto tal como figura, limpio y legible",
      "cantidad": <número: cantidad total en la unidad indicada>,
      "unidad": "kg" | "litros" | "unidades",
      "precioTotal": <número: importe total del renglón en pesos>
    }
  ]
}

Reglas:
- Si un renglón dice "5 x 1kg" la cantidad es 5 y la unidad "kg".
- Bultos/cajones/bolsas: convertí a kg totales si el peso figura; si no, usá "unidades".
- Líquidos (aceites, lácteos líquidos, bebidas): unidad "litros".
- Ignorá renglones de flete, descuentos, IVA y subtotales.
- Si la fecha no se lee, usá la fecha más probable o dejá "".
- precioTotal es el importe del renglón (no el unitario).

Además, para cada ítem agregá dos campos:
- "match": si el producto corresponde a alguno del CATÁLOGO del cliente (abajo), poné el nombre EXACTO tal como figura en el catálogo. Usá criterio gastronómico: "bife anch s/h" matchea "Ojo de bife", "crema x5" matchea "Crema de leche". Si no corresponde a ninguno, poné null. NO fuerces matches dudosos: ante la duda, null.
- "categoria": elegí UNA de las CATEGORÍAS del cliente (abajo) que mejor describa el producto. Solo se usa si match es null.

CATEGORÍAS del cliente: ${JSON.stringify(categorias||[])}
CATÁLOGO del cliente: ${JSON.stringify(ingredientes||[])}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: [bloqueArchivo, { type: 'text', text: prompt }]
        }]
      })
    });

    if (!r.ok) {
      const detalle = await r.text();
      return res.status(502).json({ error: 'Error de la API de IA', detalle: detalle.slice(0, 300) });
    }

    const j = await r.json();
    const texto = (j.content || [])
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(texto);
    } catch (e) {
      return res.status(502).json({ error: 'La IA no devolvió JSON válido', crudo: texto.slice(0, 300) });
    }

    if (!Array.isArray(parsed.items)) parsed.items = [];
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: 'Error procesando la factura', detalle: String(e).slice(0, 300) });
  }
}
