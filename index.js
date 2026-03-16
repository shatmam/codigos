const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// --- 🔑 CONFIGURACIONES ---
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78';
const ADMIN_PHONE = '18494736782'; // <-- Tu número para recibir avisos sin perfil

// --- 📲 FUNCIÓN ENVIAR WHATSAPP ---
async function enviarWA(tel, msj) {
    const url = 'https://www.wasenderapi.com/api/send-message';
    try {
        let numero = tel.toString().replace(/[^0-9]/g, '');
        let phone_e164 = '+' + numero;

        console.log('← ENVIANDO WHATSAPP A: ' + phone_e164);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + WA_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'to': phone_e164,
                'text': msj
            })
        });
        const resData = await response.json();
        console.log('✅ Respuesta API:', JSON.stringify(resData));
    } catch (e) { console.error('❌ Error WA:', e.message); }
}

// --- 📋 PROCESADOR DE CORREOS ---
async function procesarYNotificar(correoNetflix, cuerpoParsed) {
    try {
        if (!process.env.GOOGLE_CREDENTIALS) return console.log("❌ Falta GOOGLE_CREDENTIALS");

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Hoja1!A2:H500', 
        });

        const filas = res.data.values;
        if (!filas) return;

        const cuerpoTexto = (cuerpoParsed.text || "").toLowerCase();
        const html = (cuerpoParsed.html || "");

        // 1. Identificar Perfil (1, 2, 3, 4, 5 o Cristal)
        let perfilEnCorreo = "";
        const matchPerfil = cuerpoTexto.match(/hola,?\s*(\d+):/i) || cuerpoTexto.match(/perfil\s*(\d+)/i) || cuerpoTexto.match(/solicitud de\s*(\d+)/i);
        
        if (matchPerfil) {
            perfilEnCorreo = matchPerfil[1].trim();
        } else if (cuerpoTexto.includes("cristal")) {
            perfilEnCorreo = "cristal";
        }

        console.log(`🔍 Analizando: ${correoNetflix} | Perfil Detectado: [${perfilEnCorreo}]`);

        // 2. Buscar Cliente Exacto o Dueño de Cuenta Completa
        const cliente = filas.find(f => {
            const correoSheet = (f[4] || "").toLowerCase().trim();
            const perfilSheet = (f[6] || "").toString().toLowerCase().trim();
            return correoSheet === correoNetflix.toLowerCase().trim() && 
                   (perfilSheet === perfilEnCorreo || perfilSheet === "completa");
        });

        // 3. Extraer contenido útil (Link o Código)
        const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || 
                          html.match(/href="([^"]*confirm-account[^"]*)"/) ||
                          html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);
        
        const codMatch = cuerpoTexto.match(/\b\d{4}\b/);
        const anio = new Date().getFullYear().toString();
        const codigo = (codMatch && codMatch[0] !== anio) ? codMatch[0] : null;

        const FRASE = '\n\nEste mensaje se envía automáticamente para más info contacta tu proveedor';

        if (cliente) {
            // ✅ TENEMOS CLIENTE: Enviamos a su número
            let msjCliente = "";
            if (linkMatch) {
                msjCliente = `*NETFLIX ACCESO* 🔗\n\nHola *${cliente[1]}*, detectamos un acceso. Presiona aquí:\n\n${linkMatch[1]}${FRASE}`;
            } else if (codigo) {
                msjCliente = `*NETFLIX CÓDIGO* 🍿\n\nHola *${cliente[1]}*, tu código es: *${codigo}*${FRASE}`;
            }
            
            if (msjCliente) await enviarWA(cliente[2], msjCliente);

        } else if (perfilEnCorreo === "" && (linkMatch || codigo)) {
            // ⚠️ NO HAY PERFIL: Enviamos aviso al ADMIN
            let tipo = linkMatch ? "Enlace de Acceso" : "Código";
            let contenido = linkMatch ? linkMatch[1] : codigo;
            
            let msjAdmin = `*AVISO ADMIN: SIN PERFIL* ⚠️\n\nLlegó un ${tipo} para:\n📧 ${correoNetflix}\n\nContenido:\n${contenido}\n\n_Búscalo manualmente para reenviar._`;
            
            await enviarWA(ADMIN_PHONE, msjAdmin);
            console.log("📢 Notificación enviada al administrador por perfil no identificado.");
        }

    } catch (e) { console.error("❌ Error en Procesador:", e.message); }
}

// --- 📧 RUTA API PRINCIPAL ---
app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false, tls: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');
        let emails = [];
        let list = await client.search({ from: "netflix" });

        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let parsed = await simpleParser(msg.source);
            let subject = (msg.envelope.subject || "").toLowerCase();

            // Filtro: Códigos, Hogar, Viaje, Temporales e Inicio de Sesión
            const esUtil = subject.includes("código") || subject.includes("codigo") || 
                           subject.includes("temporal") || subject.includes("hogar") || 
                           subject.includes("viaje") || subject.includes("sesion") || 
                           subject.includes("sesión") || subject.includes("inicio");

            // Bloqueo: Cambios de contraseña/seguridad
            const esBloqueado = subject.includes("contraseña") || subject.includes("password") || subject.includes("cambio");

            if (esUtil && !esBloqueado) {
                await procesarYNotificar(msg.envelope.to[0].address, parsed);

                emails.push({
                    subject: msg.envelope.subject,
                    date: new Date(msg.envelope.date).toLocaleString('es-DO'),
                    to: msg.envelope.to[0].address, 
                    html: parsed.html
                });
            }
        }
        await client.logout();
        res.json({ emails });
    } catch (error) {
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema Completo: Clientes + Admin Backup"); });
