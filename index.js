const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// 🟢 LO QUE QUEREMOS (Códigos de desbloqueo)
// Añadimos variaciones para que no falle
const SOLO_ESTO = ["hogar", "viaje", "temporal", "acceso", "código", "codigo"];

// 🔴 LO QUE BLOQUEAMOS (Cambios y avisos de inicio de sesión)
const BLOQUEAR_SIEMPRE = [
    "inicio de sesión", "inicio de sesion", "iniciar sesión", "iniciar sesion",
    "cambio en tu cuenta", "cambiar la información", "restablecer", "reestablecer"
];

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false, tls: { rejectUnauthorized: false },
        connectionTimeout: 8000 // Aumentamos un poco el tiempo de espera
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');
        
        let emails = [];
        let list = await client.search({ from: "netflix" });
        const ahora = new Date();

        // Revisamos los últimos 10 para asegurar que no se nos pierda ninguno
        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            // Filtro de 15 minutos
            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                let parsed = await simpleParser(msg.source);
                let contenido = (parsed.text || "").toLowerCase();

                // 1. ¿Es un correo de cambio o simple aviso de sesión?
                const esBasura = BLOQUEAR_SIEMPRE.some(frase => 
                    subject.includes(frase) || contenido.includes(frase)
                );
                
                // 2. ¿Es un código de acceso o temporal?
                const esCodigoValido = SOLO_ESTO.some(p => 
                    subject.includes(p) || contenido.includes(p)
                );

                // REGLA: Si NO es basura Y tiene alguna palabra de acceso/código, lo mostramos.
                if (!esBasura && esCodigoValido) {
                    const fechaRD = fechaCorreo.toLocaleString('es-DO', {
                        timeZone: 'America/Santo_Domingo',
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                    });

                    emails.push({
                        subject: msg.envelope.subject,
                        date: fechaRD,
                        to: msg.envelope.to[0].address, 
                        html: parsed.html || `<pre>${parsed.text}</pre>`
                    });
                }
