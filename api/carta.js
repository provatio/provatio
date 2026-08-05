═══════════════════════════════════════════════════════════════════════════
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
- Si un plato dice "para 2 personas", ponelo igual y dejá constancia en la descripción.

FORMATO DEL JSON — el sistema lee la respuesta con una máquina, no con ojos:
- Todo en una sola línea por objeto. Nunca cortes un texto con un Enter en el medio.
- Si un nombre lleva comillas o pulgadas, escribilas como \\" o cambialas por comillas simples.`;

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

10. Respetá el precioVenta y el nombre EXACTOS que te paso. No los cambies.

FORMATO DEL JSON — el sistema lee la respuesta con una máquina, no con ojos:
- Un objeto por línea. Nunca cortes un texto con un Enter en el medio.
- Sin comas de más antes de cerrar un } o un ].
- Si un nombre lleva comillas, escribilas como \\" o cambialas por comillas simples.
- No agregues comentarios ni explicaciones. Solo el objeto JSON.`;

// ═══════════════════════════════════════════════════════════════════════════
// LECTURA DEL JSON QUE DEVUELVE LA IA
//
// Por qué esto es tan largo: antes se hacía un JSON.parse de una sola pieza.
// Una coma mal puesta en la receta 17 tiraba abajo las otras 29 — y con ellas
// cinco minutos de lectura. Ahora hay tres escalones, del más limpio al más
// desesperado, y el último rescata receta por receta: lo que está bien
// escrito entra, lo que está roto se descarta solo.
// ═══════════════════════════════════════════════════════════════════════════

// Escalón 2: arregla lo que suele romperse — saltos de línea dentro de un
// texto entrecomillado, tabulaciones, y comas colgando antes de cerrar.
function repararJSON(txt) {
  let out = '', dentro = false, escapado = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (escapado) { out += ch; escapado = false; continue; }
    if (ch === '\\') { out += ch; escapado = true; continue; }
    if (ch === '"') { dentro = !dentro; out += ch; continue; }
    if (dentro) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (ch.charCodeAt(0) < 32) { continue; }
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

// Escalón 3: rescate por objeto. Busca "clave":[ y va sacando los objetos de
// adentro uno por uno, contando llaves. Cada uno se parsea por separado: si
// uno viene roto se saltea y se sigue con el siguiente. Si la respuesta quedó
// cortada por la mitad, se queda con todo lo completo hasta ahí.
function rescatarObjetos(txt, clave) {
  const m = new RegExp('"' + clave + '"\\s*:\\s*\\[').exec(txt);
  if (!m) return { ok: [], rotos: 0 };
  let i = m.index + m[0].length;
  const ok = [];
  let rotos = 0;
  while (i < txt.length) {
    while (i < txt.length && (txt[i] === ' ' || txt[i] === ',' || txt[i] === '\n' || txt[i] === '\r' || txt[i] === '\t')) i++;
    if (txt[i] !== '{') break;              // fin del array (o basura)
    let prof = 0, dentro = false, escapado = false, j = i, cerrado = false;
    for (; j < txt.length; j++) {
      const c = txt[j];
      if (escapado) { escapado = false; continue; }
      if (c === '\\') { escapado = true; continue; }
      if (c === '"') { dentro = !dentro; continue; }
      if (dentro) continue;
      if (c === '{') prof++;
      else if (c === '}') { prof--; if (prof === 0) { j++; cerrado = true; break; } }
    }
    if (!cerrado) break;                    // se cortó la respuesta acá
    const frag = txt.slice(i, j);
    try { ok.push(JSON.parse(frag)); }
    catch (_) {
      try { ok.push(JSON.parse(repararJSON(frag))); }
      catch (_2) { rotos++; }               // este objeto se pierde, el resto no
    }
    i = j;
  }
  return { ok, rotos };
}

// Devuelve { datos, rotos, modo } — nunca tira error si hay algo rescatable.
function leerRespuesta(texto, claves) {
  const limpio0 = texto.replace(/```json/g, '').replace(/```/g, '').trim();
  const desde = limpio0.indexOf('{');
  const hasta = limpio0.lastIndexOf('}');
  const bruto = desde >= 0 ? limpio0.slice(desde, hasta > desde ? hasta + 1 : undefined) : limpio0;

  // Escalón 1: tal cual vino.
  try { return { datos: JSON.parse(bruto), rotos: 0, modo: 'directo' }; } catch (_) { }
  // Escalón 2: reparado.
  const arreglado = repararJSON(bruto);
  try { return { datos: JSON.parse(arreglado), rotos: 0, modo: 'reparado' }; } catch (_) { }
  // Escalón 3: rescate objeto por objeto.
  const datos = {};
  let rotos = 0, algo = false;
  for (const c of claves) {
    const r = rescatarObjetos(arreglado, c);
    datos[c] = r.ok;
    rotos += r.rotos;
    if (r.ok.length) algo = true;
  }
  const op = /"operacion"\s*:\s*"([^"]*)"/.exec(arreglado);
  if (op) datos.operacion = op[1];
  if (!algo) return null;
  return { datos, rotos, modo: 'rescate' };
}

async function llamarClaude(mensajes, maxTokens, sistema, claves) {
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

  const res = leerRespuesta(texto, claves);
  if (!res) {
    // No se rescató NADA. Acá sí hay que avisar bien, con el pedazo exacto
    // donde se rompió, para no volver a diagnosticar a ciegas.
    let pista = '';
    try { JSON.parse(texto); } catch (e) {
      const pos = /position (\d+)/.exec(e.message);
      pista = e.message.slice(0, 120);
      if (pos) pista += ' → «' + texto.slice(Math.max(0, +pos[1] - 60), +pos[1] + 60).replace(/\s+/g, ' ') + '»';
    }
    console.error('[carta] respuesta ilegible · stop_reason=' + j.stop_reason + ' · ' + pista);
    throw new Error(
      j.stop_reason === 'max_tokens'
        ? 'La respuesta de la IA se cortó por ser demasiado larga. Probá con menos platos por tanda.'
        : 'La IA no devolvió un JSON legible. ' + pista
    );
  }
  if (res.modo !== 'directo' || j.stop_reason === 'max_tokens') {
    console.warn('[carta] lectura por ' + res.modo + ' · descartados=' + res.rotos + ' · stop_reason=' + j.stop_reason);
  }
  return { ...res.datos, _rotos: res.rotos, _modo: res.modo, _cortado: j.stop_reason === 'max_tokens' };
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
        16000, PROMPT_PLATOS, ['platos']);

      const lista = Array.isArray(out.platos) ? out.platos : [];
      return res.status(200).json({
        operacion: out.operacion || '', platos: lista,
        _rotos: out._rotos, _modo: out._modo, _cortado: out._cortado,
      });
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
        32000, PROMPT_RECETAS, ['ingredientes', 'mermas', 'recetas']);

      return res.status(200).json({
        ingredientes: Array.isArray(out.ingredientes) ? out.ingredientes : [],
        mermas: Array.isArray(out.mermas) ? out.mermas : [],
        recetas: Array.isArray(out.recetas) ? out.recetas : [],
        _rotos: out._rotos, _modo: out._modo, _cortado: out._cortado,
      });
    }

    return res.status(400).json({ error: 'Acción desconocida: ' + accion });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error inesperado' });
  }
}
