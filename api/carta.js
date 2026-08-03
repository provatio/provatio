// ═══════════════════════════════════════════════════════════════════════════
// PROVATIO — /api/carta
//
// Lee la carta de un restaurante (PDF o foto) y devuelve la operación armada:
// ingredientes, mermas y recetas listas para revisar.
//
// Trabaja en DOS PASADAS, porque una carta de hotel tiene más de 100 platos y
// pedirle todo de una sola vez a la IA da respuestas truncadas:
//   · accion 'platos'  → saca de la carta lo que está escrito (nombre, precio,
//                        servicio, descripción). Salida chica y confiable.
//   · accion 'recetas' → recibe un lote de platos y devuelve ingredientes,
//                        mermas y recetas. La app lo llama por tandas.
//
// DÓNDE VA: en tu repo, junto a api/factura.js, con el nombre api/carta.js
//
// IMPORTANTE: la clave de la API vive acá, del lado del servidor, y NUNCA en
// el HTML. Si estuviera en el HTML, cualquiera que abra provatio.io se la lleva.
// ═══════════════════════════════════════════════════════════════════════════

// Usá el MISMO modelo que ya tenés en api/factura.js. Si ahí dice otra cosa,
// copiá ese string acá para no tener dos configuraciones distintas.
const MODELO = 'claude-sonnet-4-6';   // el mismo que usa api/factura.js

const CABECERAS = {
  'content-type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
};

// ── PASADA 1 · Qué dice la carta ──────────────────────────────────────────
const PROMPT_PLATOS = `Sos un chef leyendo la carta de un restaurante para cargarla en un sistema de costos.

Devolvé SOLO un objeto JSON, sin texto alrededor y sin backticks:

{"operacion":"nombre del lugar si aparece, si no vacío",
 "platos":[{"nombre":"...","precio":0,"servicio":"Almuerzo|Cena|Desayuno|Merienda","seccion":"...","descripcion":"..."}]}

Reglas:
- Un renglón por plato. No agrupes ni resumas.
- "precio": solo el número, sin símbolos ni puntos de miles.
- "seccion": el título bajo el que aparece en la carta (Entradas Frías, Grill, Pastas, Guarniciones, Postres...). Respetá el nombre tal cual está impreso.
- "descripcion": lo que la carta aclara entre paréntesis sobre qué lleva el plato. Si no aclara nada, dejalo vacío.
- "servicio": deducilo de la sección. Postres, guarniciones, entradas y pastas → Almuerzo. Cortes de parrilla y platos de autor → Cena. Omelettes y revueltos → Desayuno.
- NO incluyas vinos, cervezas, gaseosas ni aguas. Solo comida.
- Si un plato dice "para 2 personas", ponelo igual y dejá constancia en la descripción.`;

// ── PASADA 2 · Cómo se hace cada plato ────────────────────────────────────
const PROMPT_RECETAS = `Sos un chef con treinta años de cocina cargando recetas en un sistema de costos gastronómico.

Te paso una lista de platos de una carta. Devolvé SOLO un objeto JSON, sin texto alrededor y sin backticks:

{"ingredientes":[{"nombre":"...","cat":"...","unidadMedida":"kg","bulto":1,"precio":0}],
 "mermas":[{"ingrediente":"...","tecnica":"...","pct":0}],
 "recetas":[{"nombre":"...","tipoServicio":"...","porciones":1,"precioVenta":0,
             "ingredientes":[{"ingrediente":"...","tecnica":"...","neto":0}]}]}

REGLAS DE COCINA — esto es lo que hace que sirva o no sirva:

1. GRAMAJES REALES DE SERVICIO. Un plato principal de carne lleva 250-350 g netos. Una guarnición, 200-250 g. Una entrada, 100-180 g. Una salsa de pasta, 100-150 g. Un postre individual, 120-180 g. No inventes cantidades de más ni de menos.

2. "neto" es lo que va AL PLATO, ya limpio y porcionado. La merma la agrega el sistema.

3. MERMAS DE OFICIO, no genéricas. Cada par ingrediente+técnica que uses en una receta TIENE que estar en la lista de mermas, si no el sistema no puede costear ese renglón. Valores reales:
   - papa pelada 22% · torneada 38% · en bastones 28%
   - carne roja limpieza y porcionado 12-18% · cocción a la parrilla 25-28%
   - pollo despiece 28% · pechuga limpieza 8%
   - pescado fileteado 22-45% según la pieza (lenguado castiga mucho)
   - langostinos pelados 40% · mejillones desvalvados 65%
   - cebolla y zanahoria peladas 18% · tomate concassé 30%
   - hojas verdes lavadas 12-25% · espinaca blanqueada 35%
   - cítricos exprimidos 55-62%
   - fiambres feteados 4-6% · queso rallado 3%
   - Si no hay proceso, usá tecnica "Sin merma" con pct 0.
   - Arroz, quinoa y legumbres ABSORBEN agua: usá pct NEGATIVO (arroz cocido -180, quinoa -180, carnaroli -160). El sistema lo interpreta como rendimiento.

4. PRECIOS DE INSUMOS en pesos argentinos, precio del BULTO de compra. Referencias: bife de chorizo 19500/kg · lomo 28000/kg · pechuga de pollo 9800/kg · salmón 42000/kg · langostinos 36000/kg · papa bolsa de 10 kg 9500 · cebolla bolsa de 10 kg 7000 · crema de leche 6800/kg · muzzarella 12500/kg · queso parmesano 28000/kg · harina bolsa de 25 kg 21000 · aceite de oliva bidón de 5 kg 42000 · huevos maple de 30 unidades 13500. Estimá el resto en esa escala.

5. UN SOLO INGREDIENTE POR COSA. Si "cebolla" ya está en la lista que te paso como YA_EXISTEN, usá exactamente ese nombre y NO lo repitas en "ingredientes". Nombres en minúscula y en singular, como los diría un cocinero: "bife de chorizo", no "Bife De Chorizo (500g)".

6. CATEGORÍAS: Carnes vacunas, Cerdo, Aves y granja, Pescados, Fiambres, Lácteos, Verduras y frutas, Secos y almacén, Masas y panificados, Condimentos, Aceites y grasas, Bebidas.

7. Para huevos usá unidadMedida "unidades", bulto 30. Todo lo demás en "kg".

8. 3 a 8 ingredientes por receta. Incluí el aceite, la manteca y los condimentos que pesan en el costo; no hace falta la sal y la pimienta.

9. Si el plato dice "para 2 personas", poné porciones 2 y los gramajes para las dos.

10. Respetá el precioVenta y el nombre EXACTOS que te paso. No los cambies.`;

async function llamarClaude(mensajes, maxTokens, sistema) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: CABECERAS,
    body: JSON.stringify({
      model: MODELO,
      max_tokens: maxTokens,
      system: sistema,
      messages: mensajes,
    }),
  });
  if (!r.ok) {
    const detalle = await r.text();
    throw new Error('La IA respondió ' + r.status + ': ' + detalle.slice(0, 300));
  }
  const j = await r.json();
  const texto = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const limpio = texto.replace(/```json/g, '').replace(/```/g, '').trim();
  const desde = limpio.indexOf('{');
  const hasta = limpio.lastIndexOf('}');
  if (desde < 0 || hasta < 0) throw new Error('La IA no devolvió un JSON legible');
  return JSON.parse(limpio.slice(desde, hasta + 1));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel' });
  }

  try {
    const { accion, mediaType, data, platos, yaExisten } = req.body || {};

    // ── Pasada 1: leer la carta ──
    if (accion === 'platos') {
      if (!data) return res.status(400).json({ error: 'No llegó el archivo' });
      const esPdf = (mediaType || '').includes('pdf');
      const bloque = esPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data } };

      const out = await llamarClaude(
        [{ role: 'user', content: [bloque, { type: 'text', text: 'Leé esta carta y devolvé el JSON de platos.' }] }],
        16000, PROMPT_PLATOS);

      const lista = Array.isArray(out.platos) ? out.platos : [];
      return res.status(200).json({ operacion: out.operacion || '', platos: lista });
    }

    // ── Pasada 2: armar las recetas de un lote ──
    if (accion === 'recetas') {
      if (!Array.isArray(platos) || !platos.length) {
        return res.status(400).json({ error: 'No llegaron platos para armar' });
      }
      const contexto =
        (Array.isArray(yaExisten) && yaExisten.length
          ? 'YA_EXISTEN (usá estos nombres tal cual y no los repitas en "ingredientes"):\n' + yaExisten.join(', ') + '\n\n'
          : '') +
        'PLATOS A ARMAR:\n' + JSON.stringify(platos);

      const out = await llamarClaude(
        [{ role: 'user', content: [{ type: 'text', text: contexto }] }],
        32000, PROMPT_RECETAS);

      return res.status(200).json({
        ingredientes: Array.isArray(out.ingredientes) ? out.ingredientes : [],
        mermas: Array.isArray(out.mermas) ? out.mermas : [],
        recetas: Array.isArray(out.recetas) ? out.recetas : [],
      });
    }

    return res.status(400).json({ error: 'Acción desconocida: ' + accion });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error inesperado' });
  }
}
