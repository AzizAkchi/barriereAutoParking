
const DATABASE_URL =
  "https://barriereautoparking-default-rtdb.europe-west1.firebasedatabase.app";

const SENSORS_URL = `${DATABASE_URL}/parking/sensors.json`;
const COMMAND_URL = `${DATABASE_URL}/parking/command.json`;

const $ = (id) => document.getElementById(id);

let isBusy = false;
let lastSensorData = null;
let lastSuccessfulRead = 0;

function setConnection(online, message) {
  $("connectionDot").className =
    `dot ${online ? "online" : "offline"}`;
  $("connectionText").textContent = message;
}

function showMessage(message, type = "") {
  $("commandMessage").textContent = message;
  $("commandMessage").className = `message ${type}`;
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined ||
      !Number.isFinite(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits);
}

async function firebaseRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

function updateDashboard(data) {
  $("temperature").textContent =
    formatNumber(data.temperature, 1);

  $("humidity").textContent =
    formatNumber(data.humidity, 0);

  $("distance").textContent =
    data.distanceCm == null || Number(data.distanceCm) < 0
      ? "--"
      : formatNumber(data.distanceCm, 1);

  $("light").textContent =
    formatNumber(data.lightValue, 0);

  $("angle").textContent =
    formatNumber(data.barrierAngle, 0);

  $("potValue").textContent =
    formatNumber(data.potValue, 0);

  const angle = Math.max(
    0,
    Math.min(90, Number(data.barrierAngle) || 0)
  );

  $("angleProgress").style.width = `${(angle / 90) * 100}%`;

  // Visuel : 0° = fermée, 90° = ouverte.
  $("barrierArm").style.transform = `rotate(${-angle}deg)`;

  const open = angle >= 45;
  const badge = $("barrierBadge");

  badge.textContent = open ? "Ouverte" : "Fermée";
  badge.className = `badge ${open ? "open" : "closed"}`;

  const obstacle = data.obstacleDetected === true;
  const obstacleCard = $("obstacleCard");

  obstacleCard.className =
    `obstacle-card ${obstacle ? "danger" : "safe"}`;

  $("obstacleIcon").textContent = obstacle ? "!" : "✓";
  $("obstacleTitle").textContent =
    obstacle ? "Obstacle détecté" : "Aucun obstacle";

  $("obstacleDescription").textContent = obstacle
    ? "La barrière est forcée en position ouverte."
    : "Aucun obstacle détecté à moins de 20 cm.";

  $("ledStatus").textContent =
    obstacle ? "Allumée" : "Éteinte";

  $("buzzerStatus").textContent =
    obstacle ? "Actif" : "Inactif";

  $("modeStatus").textContent =
    data.mode === "REMOTE" ? "Distant" : "Local";

  $("systemStatus").textContent =
    obstacle ? "Obstacle détecté" : "Système opérationnel";

  $("lastUpdate").textContent =
    `Dernière réception : ${new Date().toLocaleTimeString("fr-FR")}`;

  lastSensorData = data;
}

async function readSensors() {
  try {
    const data = await firebaseRequest(SENSORS_URL);

    if (!data || typeof data !== "object") {
      setConnection(false, "En attente des mesures");
      $("systemStatus").textContent = "Aucune mesure";
      return;
    }

    updateDashboard(data);
    lastSuccessfulRead = Date.now();
    setConnection(true, "Firebase connecté");

    // Indication de la source des données
    if (data.mode === "REMOTE") {
      showMessage("Mode distant actif.", "success");
    } else {
      showMessage("Mode local actif : potentiomètre.", "");
    }
  } catch (error) {
    console.error("Lecture Firebase :", error);
    setConnection(false, "Erreur de connexion");
    $("systemStatus").textContent = "Connexion indisponible";
  }
}

async function sendCommand(mode, angle = 0) {
  if (isBusy) return;

  isBusy = true;
  $("openButton").disabled = true;
  $("closeButton").disabled = true;
  $("localButton").disabled = true;

  try {
    const command = {
      mode,
      angle,
      updatedAt: new Date().toISOString()
    };

    await firebaseRequest(COMMAND_URL, {
      method: "PUT",
      body: JSON.stringify(command)
    });

    if (mode === "remote") {
      showMessage(
        angle >= 45
          ? "Commande d'ouverture envoyée à l'ESP32."
          : "Commande de fermeture envoyée à l'ESP32.",
        "success"
      );
    } else {
      showMessage(
        "Mode local demandé. Le potentiomètre reprend le contrôle.",
        "success"
      );
    }

    // Les mesures ne changent qu'après la réponse de l'ESP32.
    await readSensors();
  } catch (error) {
    console.error("Écriture Firebase :", error);
    showMessage(
      "Échec de l'envoi. Vérifie la connexion et les règles Firebase.",
      "error"
    );
  } finally {
    isBusy = false;
    $("openButton").disabled = false;
    $("closeButton").disabled = false;
    $("localButton").disabled = false;
  }
}

$("openButton").addEventListener("click", () => {
  sendCommand("remote", 90);
});

$("closeButton").addEventListener("click", () => {
  if (lastSensorData?.obstacleDetected === true) {
    showMessage(
      "Fermeture refusée : un obstacle est détecté.",
      "error"
    );
    return;
  }

  sendCommand("remote", 0);
});

$("localButton").addEventListener("click", () => {
  sendCommand("local", 0);
});

// Actualisation périodique des mesures.
readSensors();
setInterval(readSensors, 1500);

// Signaler une connexion probablement perdue.
setInterval(() => {
  if (
    lastSuccessfulRead &&
    Date.now() - lastSuccessfulRead > 7000
  ) {
    setConnection(false, "Données non actualisées");
  }
}, 2000);
