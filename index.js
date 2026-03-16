const express = require("express");
const cors = require("cors");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const venom = require("venom-bot");

const app = express();
app.use(cors());
app.use(express.json());

/* ================================
CONFIGURACION
================================ */

const ADMIN = "18293654405@c.us";

const SHEET_ID = "TU_SHEET_ID";

/* ================================
GOOGLE SHEETS
================================ */

const auth = new google.auth.GoogleAuth({
  keyFile: "credenciales.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
});

const sheets = google.sheets({
  version: "v4",
  auth
});

async function obtenerClientes() {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A2:K"
  });

  return res.data.values || [];

}

/* ================================
WHATSAPP
================================ */

let whatsapp;

venom
.create()
.then(client => {
  whatsapp = client;
  console.log("WhatsApp conectado");
});

/* ================================
CORREOS
================================ */

const emails = [];

const imap = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: {
    user: "TU_CORREO@gmail.com",
    pass: "TU_APP_PASSWORD"
  }
});

async function iniciarCorreo() {

  await imap.connect();

  let lock = await imap.getMailboxLock("INBOX");

  try {

    for await (let msg of imap.fetch("1:*", {
      envelope: true,
      source: true
    })) {

      const parsed = await simpleParser(msg.source);

      const texto = parsed.text || "";
      const html = parsed.html || "";

      const correoDestino = parsed.to?.value?.[0]?.address || "";
      const asunto = parsed.subject || "";

      const codMatch =
        texto.match(/\b\d{4,6}\b/) ||
        html.match(/\b\d{4,6}\b/);

      const codigo = codMatch ? codMatch[0] : "Sin código";

      emails.unshift({
        subject: asunto,
        date: new Date().toLocaleString("es-DO"),
        to: correoDestino,
        contenido: codigo
      });

      if (emails.length > 50) emails.pop();

      await procesarYNotificar(correoDestino, asunto, texto, html, codigo);

    }

  } finally {

    lock.release();

  }

}

iniciarCorreo();

/* ================================
PROCESAR CLIENTE
================================ */

async function procesarYNotificar(correoNetflix, asunto, texto, html, codigo) {

  const clientes = await obtenerClientes();

  const correoLimpio = correoNetflix
  .toLowerCase()
  .replace(/\+.*@/, "@")
  .trim();

  const cliente = clientes.find(f => {

    const correo = (f[4] || "")
    .toLowerCase()
    .replace(/\+.*@/, "@")
    .trim();

    return correo === correoLimpio;

  });

  /* ================================
  NO CLIENTE → ADMIN
  ================================ */

  if (!cliente) {

    const msg = `⚠️ CODIGO SIN CLIENTE

Correo: ${correoNetflix}

Asunto: ${asunto}

Codigo: ${codigo}`;

    if (whatsapp) {
      await whatsapp.sendText(ADMIN, msg);
    }

    return;

  }

  /* ================================
  CLIENTE
  ================================ */

  const nombre = cliente[1] || "Cliente";
  const telefono = cliente[2] || "";
  const servicio = cliente[3] || "";

  const numero = telefono + "@c.us";

  let mensaje = "";

  /* ================================
  CODIGO NETFLIX
  ================================ */

  if (asunto.toLowerCase().includes("código")) {

    mensaje = `🎬 NETFLIX

Hola ${nombre}

Tu código de inicio de sesión es:

${codigo}`;

  }

  /* ================================
  ACTUALIZAR HOGAR
  ================================ */

  if (html.includes("Actualizar hogar")) {

    const linkMatch = html.match(/https:\/\/www\.netflix\.com\/account\/update-primary-location[^\"]+/);

    const link = linkMatch ? linkMatch[0] : "";

    mensaje = `🏠 ACTUALIZAR HOGAR NETFLIX

Hola ${nombre}

Debes actualizar el hogar.

Abre este enlace:

${link}`;

  }

  /* ================================
  CODIGO TEMPORAL
  ================================ */

  if (asunto.toLowerCase().includes("temporal")) {

    mensaje = `🔐 CODIGO TEMPORAL

Hola ${nombre}

Usa este código temporal:

${codigo}`;

  }

  if (mensaje && whatsapp) {

    await whatsapp.sendText(numero, mensaje);

  }

}

/* ================================
API PANEL
================================ */

app.get("/api/emails", (req, res) => {

  res.json(emails);

});

/* ================================
SERVIDOR
================================ */

app.listen(3000, () => {

  console.log("Servidor activo en puerto 3000");

});
