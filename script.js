// Estado global y configuración de temporizadores
const COOLDOWN_MS = 1500; // 1.5 segundos de pausa entre envíos
const TIMEOUT_MS = 30000; // 30 segundos límite de espera
const MAX_CARACTERES = 500;

let isProcessing = false;
let cooldownActive = false;
let memoriaSessionId = null;

// Elementos del DOM
const chatZone = document.getElementById('zonaDeChat');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const btnText = document.getElementById('btnText');
const cooldownTimerDiv = document.getElementById('cooldownTimer');
const secondsLeftSpan = document.getElementById('secondsLeft');

// Generar o recuperar el identificador único de sesión
function obtenerSessionId() {
  if (memoriaSessionId) return memoriaSessionId;

  const claveStorage = 'promptin_session_id';
  try {
    const guardado = localStorage.getItem(claveStorage);
    if (guardado) {
      memoriaSessionId = guardado;
      return memoriaSessionId;
    }
  } catch (e) {
    // Si el almacenamiento local está bloqueado, seguimos con memoria
  }

  // Generar un ID nuevo
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    memoriaSessionId = crypto.randomUUID();
  } else {
    memoriaSessionId = 'sess-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
  }

  try {
    localStorage.setItem(claveStorage, memoriaSessionId);
  } catch (e) {
    // Ignorar error si no se puede guardar en localStorage
  }

  return memoriaSessionId;
}

// Inicializar sessionId al arrancar la aplicación
const sessionId = obtenerSessionId();

// Validar si la URL del webhook está configurada
function webhookConfigurado() {
  if (typeof WEBHOOK_URL === 'undefined') return false;
  const url = String(WEBHOOK_URL).trim();
  if (!url || url.includes('ACA VA') || url.includes('ejemplo-webhook-prueba')) {
    return false;
  }
  return true;
}

// Obtener hora actual formateada
function obtenerHoraActual() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Agregar un mensaje a la zona de chat usando textContent por seguridad
function agregarMensaje(texto, esUsuario = false, esError = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${esUsuario ? 'user-message' : 'bot-message'} ${esError ? 'error-message' : ''}`;

  if (!esUsuario) {
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'bot-avatar';
    avatarDiv.textContent = '🤖';
    msgDiv.appendChild(avatarDiv);
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  const parrafo = document.createElement('p');
  parrafo.textContent = texto;

  const horaSpan = document.createElement('span');
  horaSpan.className = 'message-time';
  horaSpan.textContent = obtenerHoraActual();

  contentDiv.appendChild(parrafo);
  contentDiv.appendChild(horaSpan);
  msgDiv.appendChild(contentDiv);

  chatZone.appendChild(msgDiv);
  chatZone.scrollTop = chatZone.scrollHeight;
  return msgDiv;
}

// Mostrar indicador visual de "cargando"
function crearIndicadorCarga() {
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message bot-message';
  loadingDiv.id = 'loadingIndicator';
  loadingDiv.innerHTML = `
    <div class="bot-avatar">🤖</div>
    <div class="message-content">
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatZone.appendChild(loadingDiv);
  chatZone.scrollTop = chatZone.scrollHeight;
}

// Quitar indicador de "cargando"
function removerIndicadorCarga() {
  const indicator = document.getElementById('loadingIndicator');
  if (indicator) indicator.remove();
}

// Rellenar texto mediante botones de sugerencia
function usarSugerencia(texto) {
  if (isProcessing || cooldownActive) return;
  userInput.value = texto.slice(0, MAX_CARACTERES);
  userInput.focus();
}

// Actualizar estado de bloqueo de controles (botón y campo)
function actualizarEstadoControles() {
  const bloquear = isProcessing || cooldownActive;
  sendBtn.disabled = bloquear;
  userInput.disabled = isProcessing;
}

// Iniciar pausa obligatoria de 1.5 segundos entre envíos
function iniciarCooldown() {
  cooldownActive = true;
  let restante = COOLDOWN_MS / 1000;
  secondsLeftSpan.textContent = restante.toFixed(1);
  cooldownTimerDiv.classList.remove('hidden');
  actualizarEstadoControles();

  const paso = 500;
  const interval = setInterval(() => {
    restante = Math.max(0, restante - 0.5);
    secondsLeftSpan.textContent = restante.toFixed(1);

    if (restante <= 0) {
      clearInterval(interval);
      cooldownActive = false;
      cooldownTimerDiv.classList.add('hidden');
      actualizarEstadoControles();
      userInput.focus();
    }
  }, paso);
}

// Limpiar envoltorios Markdown (ej. ```json ... ```)
function limpiarMarkdown(texto) {
  let limpio = texto.trim();
  if (limpio.startsWith('```')) {
    limpio = limpio.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  }
  return limpio.trim();
}

// Extraer el primer campo de texto válido según el orden de prioridad
function extraerTextoDeObjeto(obj) {
  const claves = ['response', 'respuesta', 'message', 'mensaje'];
  for (const clave of claves) {
    if (typeof obj[clave] === 'string' && obj[clave].trim() !== '') {
      return obj[clave];
    }
  }
  return 'Make respondió, pero sin el campo response';
}

// Extraer valor por expresión regular si el JSON viene mal formado por saltos de línea
function extraerPorRegex(textoCrudo) {
  const claves = ['response', 'respuesta', 'message', 'mensaje'];
  for (const clave of claves) {
    const regex = new RegExp(`"${clave}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\})`);
    const coincidencia = textoCrudo.match(regex);
    if (coincidencia && coincidencia[1].trim() !== '') {
      return coincidencia[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return null;
}

// Analizar la respuesta de Make de forma tolerante a errores
function procesarRespuestaMake(textoCrudo) {
  const limpio = limpiarMarkdown(textoCrudo);
  if (!limpio) return '(respuesta vacía)';

  try {
    const parsed = JSON.parse(limpio);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return extraerTextoDeObjeto(parsed);
    }
    // Si no es un objeto (número, booleano, null, lista o string entre comillas), devolver tal cual
    return limpio;
  } catch (e) {
    // Si parece un objeto JSON pero falló por saltos de línea sin escapar
    if (limpio.startsWith('{') && limpio.endsWith('}')) {
      try {
        const reparado = limpio.replace(/\r?\n/g, '\\n');
        const parsedReparado = JSON.parse(reparado);
        if (parsedReparado && typeof parsedReparado === 'object' && !Array.isArray(parsedReparado)) {
          return extraerTextoDeObjeto(parsedReparado);
        }
      } catch (e2) {
        const extraido = extraerPorRegex(limpio);
        if (extraido !== null) return extraido;
      }
    }
    // Texto plano real (por ejemplo "Accepted")
    return limpio;
  }
}

// Lógica principal de envío de mensaje al webhook
async function enviarMensaje(event) {
  event.preventDefault();

  if (isProcessing || cooldownActive) return;

  // Validar que la URL esté configurada antes de hacer nada
  if (!webhookConfigurado()) {
    agregarMensaje('Falta pegar la URL de tu webhook en config.js', false, true);
    return;
  }

  const mensaje = userInput.value.trim();
  if (!mensaje) return;

  if (mensaje.length > MAX_CARACTERES) {
    agregarMensaje(`El mensaje supera el límite de ${MAX_CARACTERES} caracteres.`, false, true);
    return;
  }

  // Renderizar mensaje del usuario
  agregarMensaje(mensaje, true);
  userInput.value = '';

  // Estado: cargando
  isProcessing = true;
  actualizarEstadoControles();
  btnText.textContent = 'Procesando...';
  crearIndicadorCarga();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        mensaje,
        fecha: new Date().toISOString()
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const textoRespuesta = (await respuesta.text()).trim();
    removerIndicadorCarga();

    // Estado: error del servidor
    if (!respuesta.ok) {
      agregarMensaje(
        `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
        false,
        true
      );
      return;
    }

    // Estado: éxito
    const mensajeFinal = procesarRespuestaMake(textoRespuesta);
    agregarMensaje(mensajeFinal, false);

  } catch (error) {
    clearTimeout(timeoutId);
    removerIndicadorCarga();

    // Estado: error (tiempo agotado vs falla de red)
    if (error.name === 'AbortError') {
      agregarMensaje('⏱️ Se agotó el tiempo de espera (30 segundos). Por favor intentá nuevamente.', false, true);
    } else {
      agregarMensaje('🔌 Error de conexión: no se pudo contactar con Make. Revisá tu internet o la URL del webhook.', false, true);
    }
  } finally {
    isProcessing = false;
    btnText.textContent = 'Enviar 🚀';
    iniciarCooldown();
  }
}
