// Estado global y configuración de temporizadores
const COOLDOWN_SECONDS = 5;
const TIMEOUT_MS = 10000; // 10 segundos límite de espera
let isProcessing = false;
let cooldownActive = false;

// Elementos del DOM
const chatZone = document.getElementById('zonaDeChat');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const btnText = document.getElementById('btnText');
const cooldownTimerDiv = document.getElementById('cooldownTimer');
const secondsLeftSpan = document.getElementById('secondsLeft');

// Función para obtener hora formateada
function obtenerHoraActual() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Función para agregar un mensaje a la zona de chat
function agregarMensaje(texto, esUsuario = false, esError = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${esUsuario ? 'user-message' : 'bot-message'} ${esError ? 'error-message' : ''}`;

  const avatarHTML = esUsuario ? '' : '<div class="bot-avatar">🤖</div>';
  const contentHTML = `
    <div class="message-content">
      <p>${texto}</p>
      <span class="message-time">${obtenerHoraActual()}</span>
    </div>
  `;

  msgDiv.innerHTML = avatarHTML + contentHTML;
  chatZone.appendChild(msgDiv);
  
  // Desplazamiento automático al fondo
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

function removerIndicadorCarga() {
  const indicator = document.getElementById('loadingIndicator');
  if (indicator) indicator.remove();
}

// Función para rellenar texto mediante botones de sugerencia
function usarSugerencia(texto) {
  if (isProcessing || cooldownActive) return;
  userInput.value = texto;
  userInput.focus();
}

// Iniciar temporizador de cooldown entre envíos
function iniciarCooldown() {
  cooldownActive = true;
  let remaining = COOLDOWN_SECONDS;
  secondsLeftSpan.textContent = remaining;
  cooldownTimerDiv.classList.remove('hidden');
  
  if (!isProcessing) sendBtn.disabled = true;

  const interval = setInterval(() => {
    remaining -= 1;
    secondsLeftSpan.textContent = remaining;
    
    if (remaining <= 0) {
      clearInterval(interval);
      cooldownActive = false;
      cooldownTimerDiv.classList.add('hidden');
      if (!isProcessing) sendBtn.disabled = false;
    }
  }, 1000);
}

// Lógica principal de envío de mensaje al webhook
async function enviarMensaje(event) {
  event.preventDefault();
  
  const mensaje = userInput.value.trim();
  if (!mensaje || isProcessing || cooldownActive) return;

  // Renderizar mensaje del usuario
  agregarMensaje(mensaje, true);
  userInput.value = '';

  // Actualizar estados visuales
  isProcessing = true;
  sendBtn.disabled = true;
  btnText.textContent = 'Procesando...';
  crearIndicadorCarga();

  // AbortController para tiempo límite de petición
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: mensaje,
        timestamp: new Date().toISOString()
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error en el servidor: ${response.status}`);
    }

    const data = await response.json();
    removerIndicadorCarga();

    // Mostrar respuesta del agente o mensaje predeterminado
    const respuestaTexto = data.reply || data.message || "Recibí tu consulta sobre trámites médicos. Estamos procesando la solicitud.";
    agregarMensaje(respuestaTexto, false);

  } catch (error) {
    removerIndicadorCarga();
    
    if (error.name === 'AbortError') {
      agregarMensaje("⏱️ La consulta tardó demasiado en responder. Por favor reintenta.", false, true);
    } else {
      // Respuesta simulada de demostración cuando el webhook de prueba no está activo
      agregarMensaje("ℹ️ *Respuesta de demostración*: Para gestionar ese trámite médico debes presentar DNI, credencial vigente y la orden autorizada por tu médico especialista.", false);
    }
  } finally {
    isProcessing = false;
    btnText.textContent = 'Enviar 🚀';
    
    // Activar el temporizador de espera obligatorio entre envíos
    iniciarCooldown();
  }
}
